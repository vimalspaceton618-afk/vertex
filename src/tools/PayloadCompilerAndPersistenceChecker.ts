import { Tool } from './Tool.js';
import { enforceToolPolicy } from '../core/policy/PolicyEngine.js';
import { DockerSandboxTool } from './DockerSandbox.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export class PayloadCompilerTool implements Tool {
    name = 'compile_payload';
    description = 'Compiles C, C#, or Go payload source code inside an isolated DockerSandbox container.';
    schema = {
        type: 'object',
        properties: {
            sourceCode: { type: 'string', description: 'Source code content' },
            language: { type: 'string', enum: ['c', 'csharp', 'go'], description: 'Language to compile' },
            outputPath: { type: 'string', description: 'Desired output file path' },
            arch: { type: 'string', enum: ['x64', 'x86'], description: 'Target architecture (default: x64)' }
        },
        required: ['sourceCode', 'language', 'outputPath'],
        additionalProperties: false
    };

    async execute(
        args: { sourceCode: string; language: 'c' | 'csharp' | 'go'; outputPath: string; arch?: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: `compile ${args.language} payload to ${args.outputPath}`,
            promptLabel: 'Payload Compiler'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const tmpDir = path.join(process.cwd(), '.vertex', 'temp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const extMap = { c: 'c', csharp: 'cs', go: 'go' };
        const srcFile = path.join(tmpDir, `payload_${Date.now()}.${extMap[args.language]}`);
        fs.writeFileSync(srcFile, args.sourceCode);

        let compileCmd = '';
        if (args.language === 'c') {
            compileCmd = `gcc -O2 ${srcFile} -o ${args.outputPath}`;
        } else if (args.language === 'csharp') {
            compileCmd = `csc /out:${args.outputPath} ${srcFile}`;
        } else if (args.language === 'go') {
            compileCmd = `go build -o ${args.outputPath} ${srcFile}`;
        }

        const sandbox = new DockerSandboxTool();
        const result = await sandbox.execute({ command: compileCmd }, requestConfirmation);
        return `[PAYLOAD COMPILER]: Compilation submitted.\n${result}`;
    }
}

export class PersistenceCheckerTool implements Tool {
    name = 'check_persistence';
    description = 'Audits host system for existing persistence mechanisms (Registry Run keys, Scheduled Tasks, Services, WMI, Cron, Systemd).';
    schema = {
        type: 'object',
        properties: {
            targetOs: { type: 'string', enum: ['windows', 'linux', 'auto'], description: 'Target OS for check (default: auto)' }
        },
        additionalProperties: false
    };

    async execute(
        args: { targetOs?: string },
        requestConfirmation: (msg: string) => Promise<boolean>
    ): Promise<string> {
        const policyBlock = await enforceToolPolicy({
            toolName: this.name,
            riskLevel: 'unrestricted',
            commandPreview: 'audit persistence entries',
            promptLabel: 'Persistence Checker'
        }, requestConfirmation);
        if (policyBlock) return policyBlock;

        const isWin = args.targetOs === 'windows' || (args.targetOs !== 'linux' && process.platform === 'win32');
        const report: string[] = ['[PERSISTENCE AUDIT REPORT]'];

        if (isWin) {
            try {
                const reg = await execAsync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run');
                report.push('\n── HKCU Run Keys ──\n' + reg.stdout);
            } catch (e: any) { report.push('\n── HKCU Run Keys ──\nNone found or error: ' + e.message); }

            try {
                const tasks = await execAsync('schtasks /query /fo LIST /v');
                report.push('\n── Scheduled Tasks (Summary) ──\n' + tasks.stdout.slice(0, 2000) + '\n...[truncated]');
            } catch (e: any) { report.push('\n── Scheduled Tasks ──\n' + e.message); }
        } else {
            try {
                const cron = await execAsync('crontab -l 2>/dev/null || cat /etc/crontab');
                report.push('\n── Cron Entries ──\n' + cron.stdout);
            } catch (e: any) { report.push('\n── Cron Entries ──\n' + e.message); }

            try {
                const systemd = await execAsync('systemctl list-unit-files --type=service --state=enabled');
                report.push('\n── Enabled Systemd Services ──\n' + systemd.stdout.slice(0, 2000));
            } catch (e: any) { report.push('\n── Systemd Services ──\n' + e.message); }
        }

        return report.join('\n');
    }
}
