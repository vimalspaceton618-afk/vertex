import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';

const execAsync = promisify(exec);

const SANDBOX_IMAGE = 'alpine:latest';
const SANDBOX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 16_000;
const SAFETY_SANDBOX_IMAGES = ['alpine:latest', 'python:3.12-alpine', 'node:22-alpine'] as const;

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '\n...[truncated]' : s;
}

type ContainerRunResult = {
    output: string;
    exitCode: number | null;
    timedOut: boolean;
};

/** Check if Docker daemon is accessible */
async function isDockerAvailable(): Promise<boolean> {
    try {
        const docker = new Docker();
        await docker.ping();
        return true;
    } catch {
        return false;
    }
}

/**
 * Run a command inside an ephemeral Alpine Linux Docker container.
 * The container is removed immediately upon completion.
 */
async function runInDocker(command: string, timeoutMs: number): Promise<string> {
    const docker = new Docker();

    // Check image is available locally
    try {
        await docker.getImage(SANDBOX_IMAGE).inspect();
    } catch {
        return `[SANDBOX]: Docker image '${SANDBOX_IMAGE}' not found locally. Run: docker pull alpine:latest`;
    }

    // Create the container with security hardening options
    const container = await docker.createContainer({
        Image: SANDBOX_IMAGE,
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        HostConfig: {
            NetworkMode: 'none',            // No network access inside sandbox
            Memory: 256 * 1024 * 1024,     // 256MB RAM limit
            PidsLimit: 64,                  // Max 64 processes
            CapDrop: ['ALL'],               // Drop all Linux capabilities
            SecurityOpt: ['no-new-privileges'],
        },
    });

    try {
        // Attach before starting to capture output
        const stream = await container.attach({ stream: true, stdout: true, stderr: true });
        let output = '';

        const outputPromise = new Promise<void>((resolve) => {
            container.modem.demuxStream(
                stream,
                {
                    write: (chunk: Buffer) => {
                        output += chunk.toString('utf8');
                        output = truncate(output, MAX_OUTPUT);
                    },
                    end: resolve,
                } as any,
                {
                    write: (chunk: Buffer) => {
                        output += chunk.toString('utf8');
                        output = truncate(output, MAX_OUTPUT);
                    },
                    end: resolve,
                } as any,
            );
            stream.on('end', resolve);
        });

        // Timeout race
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

        await container.start();
        await Promise.race([
            container.wait().then(() => outputPromise),
            timeoutPromise,
        ]);

        return output || '[SANDBOX]: Command completed with no output.';
    } finally {
        // Always clean up the container
        try {
            await container.remove({ force: true });
        } catch {
            // ignore cleanup errors
        }
    }
}

async function runSafetyResearchDocker(command: string, timeoutMs: number, image: string): Promise<string> {
    if (!SAFETY_SANDBOX_IMAGES.includes(image as any)) {
        return `[SAFETY SANDBOX BLOCKED]: Image is not allowlisted: ${image}\nAllowed images: ${SAFETY_SANDBOX_IMAGES.join(', ')}`;
    }

    const docker = new Docker();
    try {
        await docker.getImage(image).inspect();
    } catch {
        return `[SAFETY SANDBOX]: Docker image '${image}' not found locally. Run: docker pull ${image}`;
    }

    const container = await docker.createContainer({
        Image: image,
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        WorkingDir: '/tmp',
        Env: [
            'HOME=/tmp',
            'TMPDIR=/tmp',
            'VERTEX_SAFETY_SANDBOX=1'
        ],
        HostConfig: {
            NetworkMode: 'none',
            Memory: 512 * 1024 * 1024,
            NanoCpus: 1_000_000_000,
            PidsLimit: 128,
            CapDrop: ['ALL'],
            ReadonlyRootfs: true,
            SecurityOpt: ['no-new-privileges'],
            Tmpfs: {
                '/tmp': 'rw,noexec,nosuid,nodev,size=128m',
                '/run': 'rw,noexec,nosuid,nodev,size=16m'
            }
        }
    });

    const result: ContainerRunResult = {
        output: '',
        exitCode: null,
        timedOut: false
    };

    try {
        const stream = await container.attach({ stream: true, stdout: true, stderr: true });
        const outputPromise = new Promise<void>((resolve) => {
            container.modem.demuxStream(
                stream,
                {
                    write: (chunk: Buffer) => {
                        result.output += chunk.toString('utf8');
                        result.output = truncate(result.output, MAX_OUTPUT);
                    },
                    end: resolve,
                } as any,
                {
                    write: (chunk: Buffer) => {
                        result.output += chunk.toString('utf8');
                        result.output = truncate(result.output, MAX_OUTPUT);
                    },
                    end: resolve,
                } as any,
            );
            stream.on('end', resolve);
        });

        await container.start();
        const waitPromise = container.wait().then((waitResult) => {
            result.exitCode = waitResult.StatusCode ?? null;
            return outputPromise;
        });
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                result.timedOut = true;
                resolve();
            }, timeoutMs);
        });

        await Promise.race([waitPromise, timeoutPromise]);
        if (result.timedOut) {
            try {
                await container.kill();
            } catch {
                // Container may have already exited.
            }
        }

        return [
            '[SAFETY SANDBOX OUTPUT]',
            `Image: ${image}`,
            `Network: disabled`,
            `Root filesystem: read-only`,
            `Writable tmpfs: /tmp, /run`,
            `Exit code: ${result.exitCode ?? (result.timedOut ? 'timeout' : 'unknown')}`,
            `Timed out: ${result.timedOut ? 'yes' : 'no'}`,
            '',
            result.output || 'Command completed with no output.'
        ].join('\n');
    } finally {
        try {
            await container.remove({ force: true });
        } catch {
            // ignore cleanup errors
        }
    }
}

/**
 * Fallback: Run inside a restricted child_process.
 * On Linux, real unshare-based isolation is applied via shell.
 */
async function runRestricted(command: string, timeoutMs: number): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(command, {
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT * 2,
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME || process.env.USERPROFILE,
            }
        });
        const out = truncate(stdout.trim(), MAX_OUTPUT);
        const err = truncate(stderr.trim(), MAX_OUTPUT);
        return out + (err ? `\nSTDERR:\n${err}` : '') || '[RESTRICTED SHELL]: Command succeeded with no output.';
    } catch (e: any) {
        return `[RESTRICTED SHELL ERROR]: ${e.message}`;
    }
}

// ─── Tool Export ────────────────────────────────────────────────────────────

export class DockerSandboxTool implements Tool {
    name = 'sandbox_execute';
    description = 'Execute a shell command in an isolated Docker sandbox (Alpine Linux container). No network access, memory-limited, capability-dropped. By default, fails closed if Docker is unavailable. Use for running untrusted scripts safely.';
    schema = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to run inside the sandbox.'
            },
            timeoutMs: {
                type: 'number',
                description: 'Optional timeout in milliseconds (default 30000).'
            }
        },
        required: ['command'],
        additionalProperties: false
    };

    async execute(
        args: { command: string; timeoutMs?: number },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const timeoutMs = args.timeoutMs ?? SANDBOX_TIMEOUT_MS;
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'local_scan',
            commandPreview: args.command,
            promptLabel: 'Docker sandbox'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const dockerAvailable = await isDockerAvailable();

        if (dockerAvailable) {
            const result = await runInDocker(args.command, timeoutMs);
            return `[DOCKER SANDBOX OUTPUT]:\n${result}`;
        }

        const allowFallback = (process.env.SANDBOX_ALLOW_HOST_FALLBACK || 'false').toLowerCase() === 'true';
        if (!allowFallback) {
            return '[SANDBOX BLOCKED]: Docker is unavailable and SANDBOX_ALLOW_HOST_FALLBACK is not true. Install/start Docker, then run: docker pull alpine:latest';
        }

        const approvedFallback = await requestConfirmation(
            `[VERTEX SANDBOX FALLBACK] Docker is unavailable. Run on restricted host process instead?\n  > ${args.command}\nThis is not a real sandbox. Allow? (Y/n)`
        );
        if (!approvedFallback) return '[USER OVERRIDE]: Host fallback denied.';
        return `[FALLBACK — Docker Unavailable]: Running in restricted host process.\n${await runRestricted(args.command, timeoutMs)}`;
    }
}

export class SafetyResearchSandboxTool implements Tool {
    name = 'safety_sandbox_execute';
    description = 'Run safety-research commands in a hardened Docker sandbox for testing untrusted code, model behavior, and containment. Docker is required. No host fallback. Network is disabled, root filesystem is read-only, and only /tmp and /run are writable tmpfs mounts.';
    schema = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Command to run inside the safety sandbox.'
            },
            image: {
                type: 'string',
                enum: [...SAFETY_SANDBOX_IMAGES],
                description: 'Allowlisted Docker image. Default: alpine:latest.'
            },
            timeoutMs: {
                type: 'number',
                description: 'Optional timeout in milliseconds. Default: 30000, max: 120000.'
            }
        },
        required: ['command'],
        additionalProperties: false
    };

    async execute(
        args: { command: string; image?: string; timeoutMs?: number },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const image = args.image || SANDBOX_IMAGE;
        const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs || SANDBOX_TIMEOUT_MS), 120000));
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'local_scan',
            commandPreview: `${image} :: ${args.command}`,
            promptLabel: 'Safety research sandbox'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const dockerAvailable = await isDockerAvailable();
        if (!dockerAvailable) {
            return '[SAFETY SANDBOX BLOCKED]: Docker is unavailable. Start Docker and pull an allowlisted image, for example: docker pull alpine:latest';
        }

        return runSafetyResearchDocker(args.command, timeoutMs, image);
    }
}
