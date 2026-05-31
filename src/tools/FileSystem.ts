import { Tool } from './Tool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveInsideWorkspace } from './PathSecurity.js';
import { SharedContext } from '../core/agent/SharedContext.js';

export class ReadFileTool extends Tool {
    name = "read_file";
    description = "Reads the contents of a local file.";
    schema = {
        type: "object",
        properties: {
            filePath: { type: "string", description: "Absolute or relative path to the file" }
        },
        required: ["filePath"],
        additionalProperties: false
    };

    async execute(args: { filePath: string }): Promise<string> {
        try {
            const resolvedPath = resolveInsideWorkspace(args.filePath);
            
            // Safety check: is it a directory?
            const stats = await fs.stat(resolvedPath);
            if (stats.isDirectory()) {
                return `[IS_DIRECTORY]: ${args.filePath} is a directory. Use the "list_directory" tool to see its contents.`;
            }

            const data = await fs.readFile(resolvedPath, 'utf-8');
            SharedContext.touchFile(resolvedPath);
            return data;
        } catch (error: any) {
            return `[FILE READ ERROR]: ${error.message}`;
        }
    }
}

export class WriteFileTool extends Tool {
    name = "write_file";
    description = "Create or overwrite a file with provided content.";
    schema = {
        type: "object",
        properties: {
            filePath: { type: "string", description: "Absolute or relative path to the file" },
            content: { type: "string", description: "The content to write into the file" }
        },
        required: ["filePath", "content"],
        additionalProperties: false
    };

    async execute(args: { filePath: string, content: string }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        try {
            const resolvedPath = resolveInsideWorkspace(args.filePath);
            const approved = await requestConfirmation(`Allow VERTEX to write to ${resolvedPath}?`);
            if (!approved) return "[OPERATION CANCELLED BY USER]";
            
            // Ensure directory exists
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
            
            await fs.writeFile(resolvedPath, args.content, 'utf-8');
            SharedContext.touchFile(resolvedPath);
            SharedContext.appendAudit({ event: "write_file", filePath: resolvedPath });
            return `Successfully written to ${args.filePath}`;
        } catch (error: any) {
            return `[FILE WRITE ERROR]: ${error.message}`;
        }
    }
}

export class DeleteTool extends Tool {
    name = "delete_file_or_dir";
    description = "Deletes a file or directory permanently from the host system.";
    schema = {
        type: "object",
        properties: {
            targetPath: { type: "string", description: "Absolute or relative path to the file or directory" }
        },
        required: ["targetPath"],
        additionalProperties: false
    };

    async execute(args: { targetPath: string }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        try {
            const resolvedPath = resolveInsideWorkspace(args.targetPath);
            const approved = await requestConfirmation(`[DANGER] Allow VERTEX to permanently DELETE ${resolvedPath}?`);
            if (!approved) return "[OPERATION CANCELLED BY USER]";
            
            await fs.rm(resolvedPath, { recursive: true, force: true });
            SharedContext.appendAudit({ event: "delete_path", targetPath: resolvedPath });
            return `Successfully deleted ${args.targetPath}`;
        } catch (error: any) {
            return `[DELETE ERROR]: ${error.message}`;
        }
    }
}

export class ListDirTool extends Tool {
    name = "list_directory";
    description = "Lists files and folders inside a given directory. Helps you navigate the system.";
    schema = {
        type: "object",
        properties: {
            dirPath: { type: "string", description: "Absolute or relative path to the directory" }
        },
        required: ["dirPath"],
        additionalProperties: false
    };

    async execute(args: { dirPath: string }): Promise<string> {
        try {
            const resolvedPath = resolveInsideWorkspace(args.dirPath);
            const files = await fs.readdir(resolvedPath);
            return `Contents of ${args.dirPath}:\n${files.join('\n')}`;
        } catch (error: any) {
            return `[LIST DIR ERROR]: ${error.message}`;
        }
    }
}
