import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot } from './PathSecurity.js';
import { SharedContext } from '../core/agent/SharedContext.js';

const execAsync = promisify(exec);

async function runGit(command: string, maxChars = 12000, signal?: AbortSignal): Promise<string> {
    const root = getWorkspaceRoot();
    const { stdout, stderr } = await execAsync(command, {
        cwd: root,
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        signal
    });
    const combined = `${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`.trim();
    return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...[truncated]` : combined;
}

export class GitStatusTool extends Tool {
    name = 'git_status';
    description = 'Shows git status in short form.';
    schema = { type: 'object', properties: {}, additionalProperties: false };
    async execute(_args?: any, _requestConfirmation?: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        try {
            const out = await runGit('git status --short --branch', 12000, signal);
            SharedContext.appendAudit({ event: 'git_status' });
            return out || 'No git status output.';
        } catch (error: any) {
            if (signal?.aborted) return '[GIT STATUS CANCELLED]';
            return `[GIT STATUS ERROR]: ${error.message}`;
        }
    }
}

export class GitDiffTool extends Tool {
    name = 'git_diff';
    description = 'Shows bounded git diff output.';
    schema = {
        type: 'object',
        properties: {
            staged: { type: 'boolean', description: 'Use --staged diff.' },
            maxChars: { type: 'number', description: 'Maximum characters in output.' }
        },
        additionalProperties: false
    };
    async execute(args: { staged?: boolean; maxChars?: number }, _requestConfirmation?: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        try {
            const cmd = args?.staged ? 'git diff --staged' : 'git diff';
            return (await runGit(cmd, Number(args?.maxChars || 12000), signal)) || 'No diff output.';
        } catch (error: any) {
            if (signal?.aborted) return '[GIT DIFF CANCELLED]';
            return `[GIT DIFF ERROR]: ${error.message}`;
        }
    }
}

export class GitLogTool extends Tool {
    name = 'git_log';
    description = 'Shows recent commit history.';
    schema = {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Number of commits to include.' }
        },
        additionalProperties: false
    };
    async execute(args: { limit?: number }, _requestConfirmation?: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        try {
            const limit = Math.max(1, Math.min(Number(args?.limit || 10), 50));
            const out = await runGit(`git log -n ${limit} --oneline --decorate`, 12000, signal);
            return out || 'No git log output.';
        } catch (error: any) {
            if (signal?.aborted) return '[GIT LOG CANCELLED]';
            return `[GIT LOG ERROR]: ${error.message}`;
        }
    }
}

export class GitBranchTool extends Tool {
    name = 'git_branch';
    description = 'Shows local and current git branches.';
    schema = { type: 'object', properties: {}, additionalProperties: false };
    async execute(_args: any, _requestConfirmation: (msg: string) => Promise<boolean>, signal?: AbortSignal): Promise<string> {
        try {
            return (await runGit('git branch --list --verbose', 12000, signal)) || 'No branch output.';
        } catch (error: any) {
            if (signal?.aborted) return '[GIT BRANCH CANCELLED]';
            return `[GIT BRANCH ERROR]: ${error.message}`;
        }
    }
}
