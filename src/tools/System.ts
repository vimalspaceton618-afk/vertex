import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ProcessManagementTool extends Tool {
    name = "process_manager";
    description = "List running processes or forcefully kill a process by ID or Name. Extreme power, use with caution.";
    schema = {
        type: "object",
        properties: {
            action: { type: "string", enum: ["list", "kill"], description: "Whether to list all processes or kill a specific one" },
            target: { type: "string", description: "If action is kill, provide the Process Name (e.g., node.exe) or PID" }
        },
        required: ["action"],
        additionalProperties: false
    };

    async execute(args: { action: string, target?: string }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        try {
            const isWin = process.platform === 'win32';
            
            if (args.action === 'list') {
                const cmd = isWin ? 'tasklist' : 'ps aux';
                const { stdout } = await execAsync(cmd);
                return `Here are the currently running processes:\n${stdout.substring(0, 4000)}... (truncated if too long)`;
            } 
            else if (args.action === 'kill' && args.target) {
                const approved = await requestConfirmation(`[CRITICAL DANGER] Allow VERTEX to KILL process '${args.target}'?`);
                if (!approved) return "[OPERATION CANCELLED BY USER]";
                
                // Determine if target is PID or Name for windows
                const isPid = !isNaN(Number(args.target));
                let cmd = "";
                if (isWin) {
                    cmd = isPid ? `taskkill /F /PID ${args.target}` : `taskkill /F /IM ${args.target}`;
                } else {
                    cmd = `kill -9 ${args.target}`;
                }

                const { stdout, stderr } = await execAsync(cmd);
                return `Process Kill Result:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`;
            }

            return "Invalid action or missing target parameter.";
        } catch (error: any) {
            return `[PROCESS ERROR]: ${error.message}`;
        }
    }
}
