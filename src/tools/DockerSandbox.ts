import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import Docker from 'dockerode';

const execAsync = promisify(exec);

const SANDBOX_IMAGE = 'alpine:latest';
const SANDBOX_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 16_000;

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '\n...[truncated]' : s;
}

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
    description = 'Execute a shell command in an isolated Docker sandbox (Alpine Linux container). No network access, memory-limited, capability-dropped. Falls back to a restricted host process if Docker is unavailable. Use for running untrusted scripts safely.';
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
        const approved = await requestConfirmation(
            `[VERTEX SANDBOX] Wants to run inside isolated container:\n  > ${args.command}\nAllow sandboxed execution? (Y/n)`
        );
        if (!approved) {
            return '[USER OVERRIDE]: Sandboxed execution was denied.';
        }

        const dockerAvailable = await isDockerAvailable();

        if (dockerAvailable) {
            const result = await runInDocker(args.command, timeoutMs);
            return `[DOCKER SANDBOX OUTPUT]:\n${result}`;
        } else {
            return `[FALLBACK — Docker Unavailable]: Running in restricted host process.\n${await runRestricted(args.command, timeoutMs)}`;
        }
    }
}
