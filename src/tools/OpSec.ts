import { Tool } from './Tool.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ─── 1. Clean Artifacts Tool ───────────────────────────────────────────────────
export class CleanArtifactsTool implements Tool {
    name = 'clean_artifacts';
    description = 'Remove VERTEX operational traces, temporary files, and logs from host filesystem.';
    schema = {
        type: 'object',
        properties: {
            scope: { type: 'string', enum: ['vertex_only', 'full'], description: 'Cleanup scope' },
            dryRun: { type: 'boolean', description: 'If true, only report artifacts without deleting (default true)' }
        },
        required: ['scope'],
        additionalProperties: false
    };

    async execute(args: { scope: string; dryRun?: boolean }): Promise<string> {
        const dryRun = args.dryRun ?? true;
        const targetFiles: string[] = [];

        const vertexDir = path.join(os.homedir(), '.vertex');
        if (fs.existsSync(vertexDir)) {
            targetFiles.push(vertexDir);
        }

        const lines = [`[OPSEC CLEAN ARTIFACTS] Scope: ${args.scope} | DryRun: ${dryRun}`, ''];

        if (dryRun) {
            lines.push('Artifacts identified for removal:');
            targetFiles.forEach(f => lines.push(`  - ${f}`));
            lines.push('\nExecute with dryRun=false to perform actual deletion.');
            return lines.join('\n');
        }

        let removedCount = 0;
        for (const target of targetFiles) {
            try {
                if (fs.existsSync(target)) {
                    fs.rmSync(target, { recursive: true, force: true });
                    removedCount++;
                }
            } catch { /* skip */ }
        }

        return `[OPSEC CLEAN ARTIFACTS] Successfully purged ${removedCount} operational artifact location(s).`;
    }
}

// ─── 2. Timestomp Tool ─────────────────────────────────────────────────────────
export class TimestompTool implements Tool {
    name = 'timestomp';
    description = 'Modify file MAC (Modified/Accessed) timestamps to match a reference file or explicit timestamp.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Target file path' },
            referenceFile: { type: 'string', description: 'Reference file path to copy timestamps from' },
            timestamp: { type: 'string', description: 'ISO timestamp string (if referenceFile is not provided)' }
        },
        required: ['filePath'],
        additionalProperties: false
    };

    async execute(args: { filePath: string; referenceFile?: string; timestamp?: string }): Promise<string> {
        if (!fs.existsSync(args.filePath)) return `[TIMESTOMP ERROR]: Target file missing.`;

        let atime: Date;
        let mtime: Date;

        if (args.referenceFile && fs.existsSync(args.referenceFile)) {
            const stat = fs.statSync(args.referenceFile);
            atime = stat.atime;
            mtime = stat.mtime;
        } else if (args.timestamp) {
            const parsed = new Date(args.timestamp);
            if (isNaN(parsed.getTime())) return `[TIMESTOMP ERROR]: Invalid ISO timestamp.`;
            atime = parsed;
            mtime = parsed;
        } else {
            return `[TIMESTOMP ERROR]: Must specify referenceFile or timestamp.`;
        }

        try {
            fs.utimesSync(args.filePath, atime, mtime);
            return `[TIMESTOMP SUCCESS] ${args.filePath} timestamps updated to ${mtime.toISOString()}`;
        } catch (e: any) {
            return `[TIMESTOMP ERROR]: ${e.message}`;
        }
    }
}

// ─── 3. OpSec Audit Tool ───────────────────────────────────────────────────────
export class OpsecAuditTool implements Tool {
    name = 'opsec_audit';
    description = 'Self-audit local directory for exposed VERTEX artifacts, unencrypted credential files, or plaintext logs.';
    schema = {
        type: 'object',
        properties: {
            targetPath: { type: 'string', description: 'Directory path to audit' }
        },
        required: ['targetPath'],
        additionalProperties: false
    };

    async execute(args: { targetPath: string }): Promise<string> {
        if (!fs.existsSync(args.targetPath)) return `[OPSEC AUDIT ERROR]: Target path missing.`;

        const exposures: string[] = [];

        const walk = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.name === '.vertex' || entry.name === 'state.json') {
                    exposures.push(`[EXPOSURE] Uncleaned operational state: ${full}`);
                } else if (entry.isFile() && (entry.name.endsWith('.log') || entry.name.endsWith('.txt'))) {
                    try {
                        const content = fs.readFileSync(full, 'utf-8');
                        if (content.includes('password') || content.includes('bearer ') || content.includes('sk-proj-')) {
                            exposures.push(`[EXPOSURE] Potential unencrypted secrets in log: ${full}`);
                        }
                    } catch { /* skip */ }
                } else if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                    walk(full);
                }
            }
        };

        const stat = fs.statSync(args.targetPath);
        if (stat.isDirectory()) walk(args.targetPath);

        const score = exposures.length === 0 ? 100 : Math.max(0, 100 - (exposures.length * 20));

        const output = [
            `[OPSEC AUDIT] ${args.targetPath}`,
            `Security Score: ${score}/100`,
            '',
            `Exposures Found (${exposures.length}):`,
            ...(exposures.length ? exposures : ['  ✅ No exposed operational artifacts detected.'])
        ];

        return output.join('\n');
    }
}

// ─── 4. Secure Delete Tool ─────────────────────────────────────────────────────
export class SecureDeleteTool implements Tool {
    name = 'secure_delete';
    description = 'Overwrite file contents with random byte passes prior to unlinking to defeat basic file recovery.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'File path to securely destroy' },
            passes: { type: 'number', description: 'Number of overwrite passes (default 3)' }
        },
        required: ['filePath'],
        additionalProperties: false
    };

    async execute(args: { filePath: string; passes?: number }): Promise<string> {
        if (!fs.existsSync(args.filePath)) return `[SECURE DELETE ERROR]: File not found.`;

        const passes = args.passes || 3;
        try {
            const stat = fs.statSync(args.filePath);
            const size = stat.size;

            for (let i = 0; i < passes; i++) {
                const garbage = crypto.randomBytes(size);
                fs.writeFileSync(args.filePath, garbage);
            }

            fs.unlinkSync(args.filePath);
            return `[SECURE DELETE] ${args.filePath} securely wiped (${passes} passes) and unlinked.`;
        } catch (e: any) {
            return `[SECURE DELETE ERROR]: ${e.message}`;
        }
    }
}

// ─── 5. Process Masquerade Tool ────────────────────────────────────────────────
export class ProcessMasqueradeTool implements Tool {
    name = 'process_masquerade';
    description = 'Generate PowerShell / C# snippets for spoofed parent PID (PPID) and command-line execution.';
    schema = {
        type: 'object',
        properties: {
            targetProcess: { type: 'string', description: 'Legitimate parent process name (e.g. explorer.exe)' },
            payloadPath: { type: 'string', description: 'Binary payload path' }
        },
        required: ['targetProcess', 'payloadPath'],
        additionalProperties: false
    };

    async execute(args: { targetProcess: string; payloadPath: string }): Promise<string> {
        const snippet = [
            `# PowerShell PPID Spoofing Generator`,
            `$ParentProcess = Get-Process -Name "${args.targetProcess.replace('.exe', '')}" | Select-Object -First 1`,
            `if ($ParentProcess) {`,
            `    Write-Host "Spoofing Parent PID: $($ParentProcess.Id)"`,
            `    # Requires CreateProcess with EXTENDED_STARTUPINFO_PRESENT & PROC_THREAD_ATTRIBUTE_PARENT_PROCESS`,
            `    # Use Start-ProcessSpoofed or D/Invoke in C# payload for stealth execution:`,
            `    # Executing: ${args.payloadPath}`,
            `} else {`,
            `    Write-Host "Target parent process ${args.targetProcess} not running."`,
            `}`
        ].join('\n');

        return `[PROCESS MASQUERADE SNIPPET]\n\n${snippet}`;
    }
}
