import { Tool } from './Tool.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot, resolveInsideWorkspace } from './PathSecurity.js';

const execFileAsync = promisify(execFile);

async function walkFiles(dir: string, files: string[] = []): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
        // Do not traverse or read symlinks: a link inside the workspace can point outside it.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            await walkFiles(entryPath, files);
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

export class CodeSearchTool extends Tool {
    name = 'search_code';
    description = 'Search source files by plain text or regex-like pattern, returning bounded matches.';
    schema = {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Text pattern to find in files.' },
            targetPath: { type: 'string', description: 'Optional directory/file path relative to workspace root.' },
            maxResults: { type: 'number', description: 'Maximum number of matches to return.' }
        },
        required: ['pattern'],
        additionalProperties: false
    };

    async execute(args: { pattern: string; targetPath?: string; maxResults?: number }): Promise<string> {
        if (typeof args.pattern !== 'string' || args.pattern.length === 0 || args.pattern.length > 4096) {
            return '[SEARCH ERROR]: Pattern must contain 1–4096 characters.';
        }
        const maxResults = Math.max(1, Math.min(Number(args.maxResults || 40), 200));
        const root = getWorkspaceRoot();
        const target = args.targetPath ? resolveInsideWorkspace(args.targetPath) : root;
        try {
            const rgArgs = [
                '-n', '--hidden',
                '--glob', '!node_modules/**',
                '--glob', '!dist/**',
                '--max-count', String(maxResults),
                '--', args.pattern, target
            ];
            const { stdout } = await execFileAsync('rg', rgArgs, { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024 });
            const output = stdout.trim();
            if (!output) return 'No matches found.';
            return output;
        } catch {
            try {
                const stats = await fs.stat(target);
                const files = stats.isDirectory() ? await walkFiles(target) : [target];
                const results: string[] = [];
                for (const file of files) {
                    if (results.length >= maxResults) break;
                    let text = '';
                    try {
                        text = await fs.readFile(file, 'utf-8');
                    } catch {
                        continue;
                    }
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes(args.pattern)) {
                            results.push(`${file}:${i + 1}:${lines[i].trim()}`);
                            if (results.length >= maxResults) break;
                        }
                    }
                }
                return results.length ? results.join('\n') : 'No matches found.';
            } catch (error: any) {
                return `[SEARCH ERROR]: ${error.message}`;
            }
        }
    }
}
