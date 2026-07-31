import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { DockerSandboxTool } from './DockerSandbox.js';
import { ToolRegistry } from './registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const targets = args.executionTarget === 'remote' && args.remoteOptions?.host ? [args.remoteOptions.host] : undefined;
        
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: args.generatedCommand,
            promptLabel: 'Auto Executor',
            targets
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        if (args.executionTarget === 'host') {
            try {
                const { stdout, stderr } = await execAsync(args.generatedCommand, { timeout: 30000 });
                return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
            } catch (e: any) {
                return `[HOST EXEC ERROR]: ${e.message}`;
            }
        } else if (args.executionTarget === 'sandbox') {
            const sandbox = new DockerSandboxTool();
            return sandbox.execute({ command: args.generatedCommand }, requestConfirmation);
        } else if (args.executionTarget === 'remote') {
            if (!args.remoteOptions?.host || !args.remoteOptions?.user) {
                return '[REMOTE EXEC ERROR]: Missing remoteOptions (host, user).';
            }
            // A simple SSH wrapper.
            const sshCommand = `ssh ${args.remoteOptions.user}@${args.remoteOptions.host} "${args.generatedCommand.replace(/"/g, '\\"')}"`;
            try {
                const { stdout, stderr } = await execAsync(sshCommand, { timeout: 30000 });
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
        requestConfirmation: (msg: string) => Promise<boolean>
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

                const result = await tool.execute(toolArgs, requestConfirmation);
                
                if (typeof result !== 'string') {
                    let genOutput = '';
                    for await (const chunk of result) {
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
