import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { DockerSandboxTool } from './DockerSandbox.js';
import { ToolRegistry } from './registry.js';
import { exec, execFile } from 'child_process';
import * as net from 'net';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Validate SSH destination components before passing them to the SSH client.
 * Commands remain shell commands on the remote host by design, but the local
 * SSH invocation must never interpolate user-controlled host/user values.
 */
export function validateRemoteTarget(host: string, user: string): string | null {
    if (!user || !/^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user)) {
        return 'Invalid SSH username.';
    }

    const candidate = host.trim();
    const unwrappedHost = candidate.startsWith('[') && candidate.endsWith(']')
        ? candidate.slice(1, -1)
        : candidate;
    const isIpAddress = net.isIP(unwrappedHost) !== 0;
    const isHostname = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(candidate);

    if (!isIpAddress && !isHostname) {
        return 'Invalid SSH host; use a hostname or IP address without a port.';
    }

    return null;
}

export class AutoExecutorTool implements Tool {
    name = 'auto_executor';
    description = 'Executes a command on the specified target (host, sandbox, or remote).';
    schema = {
        type: 'object',
        properties: {
            generatedCommand: {
                type: 'string',
                description: 'The command to execute.'
            },
            executionTarget: {
                type: 'string',
                enum: ['host', 'sandbox', 'remote'],
                description: 'The environment where the command will run.'
            },
            remoteOptions: {
                type: 'object',
                properties: {
                    host: { type: 'string' },
                    user: { type: 'string' },
                    auth: { type: 'string' }
                }
            }
        },
        required: ['generatedCommand', 'executionTarget'],
        additionalProperties: false
    };

    async execute(
        args: { generatedCommand: string; executionTarget: 'host' | 'sandbox' | 'remote'; remoteOptions?: { host?: string; user?: string; auth?: string } },
        requestConfirmation: (msg: string) => Promise<boolean>,
        signal?: AbortSignal
    ): Promise<string> {
        if (args.executionTarget === 'remote') {
            if (!args.remoteOptions?.host || !args.remoteOptions?.user) {
                return '[REMOTE EXEC ERROR]: Missing remoteOptions (host, user).';
            }
            const invalidTarget = validateRemoteTarget(args.remoteOptions.host, args.remoteOptions.user);
            if (invalidTarget) return `[REMOTE EXEC ERROR]: ${invalidTarget}`;
        }

        const targets = args.executionTarget === 'remote' && args.remoteOptions?.host ? [args.remoteOptions.host] : undefined;

        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: args.generatedCommand,
            promptLabel: 'Auto Executor',
            targets
        }, requestConfirmation);
        if (policyBlock) return policyBlock;
        if (signal?.aborted) return '[EXEC CANCELLED]: Request was cancelled before execution.';

        if (args.executionTarget === 'host') {
            try {
                const { stdout, stderr } = await execAsync(args.generatedCommand, { timeout: 30000, signal });
                return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
            } catch (e: any) {
                return `[HOST EXEC ERROR]: ${e.message}`;
            }
        } else if (args.executionTarget === 'sandbox') {
            const sandbox = new DockerSandboxTool();
            return sandbox.execute({ command: args.generatedCommand }, requestConfirmation, signal);
        } else if (args.executionTarget === 'remote') {
            if (!args.remoteOptions?.host || !args.remoteOptions?.user) {
                return '[REMOTE EXEC ERROR]: Missing remoteOptions (host, user).';
            }
            // Use execFile so the local shell never parses the SSH destination.
            // The remote command is intentionally passed as one SSH command argument.
            const sshTarget = `${args.remoteOptions.user}@${args.remoteOptions.host}`;
            try {
                const { stdout, stderr } = await execFileAsync(
                    'ssh',
                    ['-o', 'BatchMode=yes', '--', sshTarget, args.generatedCommand],
                    { timeout: 30000, signal }
                );
                return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
            } catch (e: any) {
                return `[REMOTE EXEC ERROR]: ${e.message}`;
            }
        }

        return `[EXEC ERROR]: Unknown executionTarget ${args.executionTarget}`;
    }
}

export class ToolPipelineTool implements Tool {
    name = 'tool_pipeline';
    description = 'Executes a simple pipeline of tool commands (e.g., "tcp_scan -> hash_identify -> hash_crack") by passing intermediate output as input to the next tool in the pipeline.';
    schema = {
        type: 'object',
        properties: {
            pipeline: {
                type: 'string',
                description: 'The pipeline sequence (e.g. "tool_a -> tool_b -> tool_c").'
            },
            initialInput: {
                type: 'string',
                description: 'The input to feed into the first tool.'
            }
        },
        required: ['pipeline'],
        additionalProperties: false
    };

    constructor(private registry: ToolRegistry) {}

    async execute(
        args: { pipeline: string; initialInput?: string },
        requestConfirmation: (msg: string) => Promise<boolean>,
        signal?: AbortSignal
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: args.pipeline,
            promptLabel: 'Tool Pipeline'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const tools = args.pipeline.split('->').map(t => t.trim()).filter(Boolean);
        let currentInput = args.initialInput || '';
        let pipelineOutput = '';

        for (const toolName of tools) {
            if (signal?.aborted) return pipelineOutput + '\n[PIPELINE CANCELLED]';
            const tool = this.registry.getTool(toolName);
            if (!tool) {
                return `[PIPELINE ERROR]: Tool not found: ${toolName}`;
            }
            
            try {
                let toolArgs: any = {};
                if (tool.schema?.properties) {
                    const props = Object.keys(tool.schema.properties);
                    if (props.includes('input')) toolArgs.input = currentInput;
                    else if (props.includes('command')) toolArgs.command = currentInput;
                    else if (props.includes('target')) toolArgs.target = currentInput;
                    else if (props.includes('text')) toolArgs.text = currentInput;
                    else if (props.length > 0) toolArgs[props[0]] = currentInput;
                }

                const result = await tool.execute(toolArgs, requestConfirmation, signal);
                if (signal?.aborted) return pipelineOutput + '\n[PIPELINE CANCELLED]';
                
                if (typeof result !== 'string') {
                    let genOutput = '';
                    for await (const chunk of result) {
                        if (signal?.aborted) return pipelineOutput + '\n[PIPELINE CANCELLED]';
                        genOutput += chunk;
                    }
                    currentInput = genOutput;
                } else {
                    currentInput = result;
                }
                
                pipelineOutput += `\n--- [${toolName} output] ---\n${currentInput}\n`;
            } catch (e: any) {
                return pipelineOutput + `\n[PIPELINE ERROR] in ${toolName}: ${e.message}`;
            }
        }

        return pipelineOutput || '[PIPELINE]: Completed with no output.';
    }
}
