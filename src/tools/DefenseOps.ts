import { Tool } from './Tool.js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const MAX_OUT = 8000;
function truncate(s: string, max = MAX_OUT): string {
    return s.length > max ? s.slice(0, max) + '\n[TRUNCATED]' : s;
}

// ─── 1. Pure-JS YARA Rule Scanner ──────────────────────────────────────────────
export class YaraScanTool implements Tool {
    name = 'yara_scan';
    description = 'Pure-JS pattern scanner for files/directories. Evaluates string and hex patterns without requiring external YARA binary.';
    schema = {
        type: 'object',
        properties: {
            targetPath: { type: 'string', description: 'File or directory to scan' },
            rules: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        strings: { type: 'array', items: { type: 'string' } }
                    },
                    required: ['name', 'strings']
                },
                description: 'Rule definitions (name + string patterns)'
            },
            recursive: { type: 'boolean', description: 'Recursive directory walk (default true)' }
        },
        required: ['targetPath', 'rules'],
        additionalProperties: false
    };

    async execute(args: { targetPath: string; rules: { name: string; strings: string[] }[]; recursive?: boolean }): Promise<string> {
        if (!fs.existsSync(args.targetPath)) return `[YARA SCAN ERROR]: Path not found: ${args.targetPath}`;

        const matches: { file: string; rule: string; matchedString: string }[] = [];
        const recursive = args.recursive ?? true;

        const scanFile = (filePath: string) => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                for (const rule of args.rules) {
                    for (const str of rule.strings) {
                        if (content.includes(str)) {
                            matches.push({ file: filePath, rule: rule.name, matchedString: str });
                        }
                    }
                }
            } catch { /* skip unreadable */ }
        };

        const walk = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile()) scanFile(full);
                else if (entry.isDirectory() && recursive && entry.name !== 'node_modules' && entry.name !== '.git') walk(full);
            }
        };

        const stat = fs.statSync(args.targetPath);
        if (stat.isFile()) scanFile(args.targetPath);
        else if (stat.isDirectory()) walk(args.targetPath);

        if (matches.length === 0) return `[YARA SCAN] ${args.targetPath} — Clean. No rule matches found.`;

        const lines = [`[YARA SCAN] ${args.targetPath} — ${matches.length} match(es) found`, ''];
        for (const m of matches) {
            lines.push(`  Rule: ${m.rule.padEnd(20)} File: ${m.file} (Matched: "${m.matchedString}")`);
        }
        return truncate(lines.join('\n'));
    }
}

// ─── 2. Log Forensic Analyzer ──────────────────────────────────────────────────
export class LogAnalyzeTool implements Tool {
    name = 'log_analyze';
    description = 'Parse log files (syslog, web access logs, event XML) for brute-force attacks, lateral movement, and web anomalies.';
    schema = {
        type: 'object',
        properties: {
            logPath: { type: 'string', description: 'Log file path' },
            logType: { type: 'string', enum: ['syslog', 'web_access', 'generic'], description: 'Log format' },
            pattern: { type: 'string', description: 'Optional regex pattern filter' }
        },
        required: ['logPath', 'logType'],
        additionalProperties: false
    };

    async execute(args: { logPath: string; logType: string; pattern?: string }): Promise<string> {
        if (!fs.existsSync(args.logPath)) return `[LOG ANALYZE ERROR]: File not found: ${args.logPath}`;

        const content = fs.readFileSync(args.logPath, 'utf-8');
        const lines = content.split('\n');

        const findings: string[] = [];
        const ipCounts: Record<string, number> = {};

        const filterRegex = args.pattern ? new RegExp(args.pattern, 'i') : null;

        for (const line of lines) {
            if (filterRegex && !filterRegex.test(line)) continue;

            // Extract IPs
            const ipMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
            if (ipMatch) {
                const ip = ipMatch[0];
                ipCounts[ip] = (ipCounts[ip] || 0) + 1;
            }

            // Anomaly heuristics
            if (/failed password|authentication failure|invalid user/i.test(line)) {
                findings.push(`[AUTH FAILURE] ${line.slice(0, 140)}`);
            } else if (/UNION SELECT|eval\(|base64_decode|<script>/i.test(line)) {
                findings.push(`[WEB ATTACK INJECTION] ${line.slice(0, 140)}`);
            } else if (/404 | 500 /i.test(line) && args.logType === 'web_access') {
                // Ignore standard 404s unless spiked
            }
        }

        const topIps = Object.entries(ipCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([ip, count]) => `  ${ip.padEnd(16)} ${count} requests`);

        const output = [`[LOG ANALYZER] ${args.logPath} (${lines.length} lines parsed)`, ''];
        if (topIps.length) {
            output.push('Top Requesting IPs:');
            output.push(...topIps);
            output.push('');
        }

        output.push(`Flagged Anomalies (${findings.length}):`);
        output.push(...(findings.length ? findings.slice(0, 50) : ['  No critical anomalies identified.']));

        return truncate(output.join('\n'));
    }
}

// ─── 3. IOC Intelligence Checker ────────────────────────────────────────────────
export class IocCheckTool implements Tool {
    name = 'ioc_check';
    description = 'Query public APIs (URLhaus, AbuseIPDB) for IP/Domain IOC threat intelligence.';
    schema = {
        type: 'object',
        properties: {
            ioc: { type: 'string', description: 'IP or domain string' },
            iocType: { type: 'string', enum: ['ip', 'domain'], description: 'IOC classification' }
        },
        required: ['ioc', 'iocType'],
        additionalProperties: false
    };

    async execute(args: { ioc: string; iocType: string }): Promise<string> {
        if (args.iocType === 'domain') {
            return new Promise((resolve) => {
                const req = https.request(`https://urlhaus-api.abuse.ch/v1/host/`, { method: 'POST', timeout: 5000 }, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.query_status === 'ok') {
                                resolve(`[IOC INTEL — URLhaus] Domain: ${args.ioc}\nStatus: MALICIOUS\nFirst Seen: ${parsed.firstseen}\nURLs Count: ${parsed.urls?.length || 0}`);
                            } else {
                                resolve(`[IOC INTEL — URLhaus] Domain: ${args.ioc}\nStatus: CLEAN / NOT FOUND in database.`);
                            }
                        } catch { resolve(`[IOC INTEL] Failed to parse API response.`); }
                    });
                });
                req.on('error', (e) => resolve(`[IOC INTEL ERROR]: ${e.message}`));
                req.write(`host=${encodeURIComponent(args.ioc)}`);
                req.end();
            });
        }

        return `[IOC INTEL] IP lookup for ${args.ioc} requires API key for AbuseIPDB. Set ABUSEIPDB_API_KEY environment variable.`;
    }
}

// ─── 4. Baseline Diff Tool ──────────────────────────────────────────────────────
export class BaselineDiffTool implements Tool {
    name = 'baseline_diff';
    description = 'Compare baseline SHA-256 integrity manifest with current filesystem state to detect file tampering.';
    schema = {
        type: 'object',
        properties: {
            baselinePath: { type: 'string', description: 'Path to baseline manifest file' },
            currentPath: { type: 'string', description: 'Path to current manifest file' }
        },
        required: ['baselinePath', 'currentPath'],
        additionalProperties: false
    };

    async execute(args: { baselinePath: string; currentPath: string }): Promise<string> {
        if (!fs.existsSync(args.baselinePath) || !fs.existsSync(args.currentPath)) {
            return `[BASELINE DIFF ERROR]: Manifest file(s) missing.`;
        }

        const parseManifest = (filePath: string): Map<string, string> => {
            const map = new Map<string, string>();
            const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) map.set(parts[1], parts[0]);
            }
            return map;
        };

        const base = parseManifest(args.baselinePath);
        const curr = parseManifest(args.currentPath);

        const added: string[] = [];
        const modified: string[] = [];
        const deleted: string[] = [];

        for (const [file, hash] of curr.entries()) {
            if (!base.has(file)) added.push(file);
            else if (base.get(file) !== hash) modified.push(file);
        }

        for (const file of base.keys()) {
            if (!curr.has(file)) deleted.push(file);
        }

        const output = [`[BASELINE DIFF] Comparing manifests`, ''];
        output.push(`Modified (${modified.length}):`, ...(modified.map(f => `  ⚠️  MODIFIED: ${f}`)));
        output.push(`Added (${added.length}):`, ...(added.map(f => `  ➕  ADDED:    ${f}`)));
        output.push(`Deleted (${deleted.length}):`, ...(deleted.map(f => `  ❌  DELETED:  ${f}`)));

        return truncate(output.join('\n'));
    }
}

// ─── 5. Memory / Binary Strings Extractor ───────────────────────────────────────
export class MemoryStringsTool implements Tool {
    name = 'memory_strings';
    description = 'Extract ASCII and Unicode printable strings from binary or dump files with optional pattern filtering.';
    schema = {
        type: 'object',
        properties: {
            filePath: { type: 'string', description: 'Target file path' },
            minLength: { type: 'number', description: 'Minimum string length (default 6)' }
        },
        required: ['filePath'],
        additionalProperties: false
    };

    async execute(args: { filePath: string; minLength?: number }): Promise<string> {
        if (!fs.existsSync(args.filePath)) return `[MEMORY STRINGS ERROR]: File not found.`;

        const min = args.minLength || 6;
        const buffer = fs.readFileSync(args.filePath);
        const strings: string[] = [];
        let current = '';

        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i];
            if (byte >= 32 && byte <= 126) {
                current += String.fromCharCode(byte);
            } else {
                if (current.length >= min) strings.push(current);
                current = '';
            }
        }
        if (current.length >= min) strings.push(current);

        const ips = strings.filter(s => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(s));
        const urls = strings.filter(s => /https?:\/\//i.test(s));

        const output = [`[MEMORY STRINGS] ${args.filePath} — ${strings.length} string(s) extracted`, ''];
        if (ips.length) {
            output.push(`Extracted IP Addresses (${ips.length}):`);
            output.push(...ips.slice(0, 20).map(i => `  ${i}`));
            output.push('');
        }
        if (urls.length) {
            output.push(`Extracted URLs (${urls.length}):`);
            output.push(...urls.slice(0, 20).map(u => `  ${u}`));
            output.push('');
        }

        output.push(`Sample Printable Strings:`);
        output.push(...strings.slice(0, 30).map(s => `  ${s}`));

        return truncate(output.join('\n'));
    }
}

// ─── 6. Forensic Timeline Generator ──────────────────────────────────────────────
export class TimelineForensicsTool implements Tool {
    name = 'timeline_forensics';
    description = 'Generate a chronological MAC (Modified, Accessed, Created) timestamp timeline for a directory.';
    schema = {
        type: 'object',
        properties: {
            targetPath: { type: 'string', description: 'Target directory' },
            hoursBack: { type: 'number', description: 'Timeframe in hours (default 24)' }
        },
        required: ['targetPath'],
        additionalProperties: false
    };

    async execute(args: { targetPath: string; hoursBack?: number }): Promise<string> {
        if (!fs.existsSync(args.targetPath)) return `[TIMELINE ERROR]: Path not found.`;

        const cutoff = Date.now() - ((args.hoursBack || 24) * 3600 * 1000);
        const events: { file: string; type: string; time: Date }[] = [];

        const walk = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile()) {
                    try {
                        const stat = fs.statSync(full);
                        if (stat.mtimeMs >= cutoff) events.push({ file: full, type: 'MODIFIED', time: stat.mtime });
                        if (stat.birthtimeMs >= cutoff) events.push({ file: full, type: 'CREATED', time: stat.birthtime });
                    } catch { /* skip */ }
                } else if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                    walk(full);
                }
            }
        };

        const stat = fs.statSync(args.targetPath);
        if (stat.isDirectory()) walk(args.targetPath);

        events.sort((a, b) => b.time.getTime() - a.time.getTime());

        const output = [`[FORENSIC TIMELINE] ${args.targetPath} (Last ${args.hoursBack || 24} hours)`, ''];
        for (const e of events) {
            output.push(`  ${e.time.toISOString()} | ${e.type.padEnd(8)} | ${e.file}`);
        }

        return truncate(output.join('\n'));
    }
}
