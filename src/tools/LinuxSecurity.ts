import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const execAsync = promisify(exec);
const MAX_OUT = 12_000;

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '\n...[truncated]' : s;
}

async function shell(cmd: string, timeoutMs = 15000): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: MAX_OUT * 2 });
        const out = truncate(stdout.trim(), MAX_OUT);
        const err = truncate(stderr.trim(), MAX_OUT);
        return out + (err ? `\nSTDERR: ${err}` : '');
    } catch (e: any) {
        const out = truncate(e.stdout?.trim() || '', MAX_OUT);
        const err = truncate(e.stderr?.trim() || e.message || '', MAX_OUT);
        return (out + '\n' + err).trim();
    }
}

// ─── 1. DNS Lookup ──────────────────────────────────────────────────────────
export class DnsLookupTool implements Tool {
    name = 'dns_lookup';
    description = 'Perform a DNS lookup for a hostname using nslookup or dig. Returns resolved IP addresses and record data. Useful for verifying DNS health, detecting DNS hijacking, and auditing network configurations.';
    schema = {
        type: 'object',
        properties: {
            hostname: { type: 'string', description: 'The hostname or domain to look up (e.g. example.com).' },
            recordType: { type: 'string', description: 'Optional DNS record type: A, AAAA, MX, TXT, NS, CNAME (default: A).', enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'] }
        },
        required: ['hostname'],
        additionalProperties: false
    };

    async execute(args: { hostname: string; recordType?: string }): Promise<string> {
        const host = args.hostname.trim();
        const type = args.recordType || 'A';

        // Try nslookup (cross-platform), then dig (Linux)
        let result = await shell(`nslookup -type=${type} ${host}`);
        if (result.includes('can\'t find') || result.includes('NXDOMAIN') || !result.trim()) {
            const digResult = await shell(`dig ${type} ${host} +short`);
            result = digResult || result;
        }

        return `[DNS LOOKUP] ${type} records for ${host}:\n${result || 'No records found.'}`;
    }
}

// ─── 2. Port Scanner ────────────────────────────────────────────────────────
export class PortScanTool implements Tool {
    name = 'port_scan';
    description = 'Scan TCP ports on a target host to detect open services. Uses nmap if available, or a built-in TCP socket scanner as fallback. Use for network reconnaissance and attack surface mapping.';
    schema = {
        type: 'object',
        properties: {
            host: { type: 'string', description: 'Target hostname or IP address to scan.' },
            ports: { type: 'string', description: 'Port range or list to scan (e.g. "22,80,443" or "1-1024"). Default: common ports.' },
            timeoutMs: { type: 'number', description: 'Per-port connection timeout in ms (default 500).' }
        },
        required: ['host'],
        additionalProperties: false
    };

    async execute(args: { host: string; ports?: string; timeoutMs?: number }): Promise<string> {
        const host = args.host.trim();
        const portsArg = args.ports || '21,22,23,25,53,80,110,143,443,445,3306,3389,5432,6379,8080,8443,27017';
        const timeout = args.timeoutMs ?? 500;

        // Try nmap first
        const nmapResult = await shell(`nmap -p ${portsArg} --open -T4 ${host}`, 60_000);
        if (nmapResult && !nmapResult.toLowerCase().includes('not found') && !nmapResult.toLowerCase().includes('command not recognized')) {
            return `[PORT SCAN via nmap]:\n${nmapResult}`;
        }

        // Built-in TCP socket fallback
        const portList = portsArg.includes('-')
            ? (() => {
                const [start, end] = portsArg.split('-').map(Number);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i);
              })()
            : portsArg.split(',').map(Number).filter(n => !isNaN(n));

        const results: string[] = [];
        const check = (port: number): Promise<void> =>
            new Promise((resolve) => {
                const socket = new net.Socket();
                socket.setTimeout(timeout);
                socket.connect(port, host, () => {
                    results.push(`  ${port}/tcp   OPEN`);
                    socket.destroy();
                    resolve();
                });
                socket.on('error', () => { socket.destroy(); resolve(); });
                socket.on('timeout', () => { socket.destroy(); resolve(); });
            });

        // Scan in parallel batches of 50
        for (let i = 0; i < portList.length; i += 50) {
            await Promise.all(portList.slice(i, i + 50).map(check));
        }

        if (results.length === 0) {
            return `[PORT SCAN] No open ports found on ${host} for ports: ${portsArg}`;
        }
        return `[PORT SCAN] Open ports on ${host}:\n${results.join('\n')}`;
    }
}

// ─── 3. Network Audit ───────────────────────────────────────────────────────
export class NetworkAuditTool implements Tool {
    name = 'network_audit';
    description = 'Audit current host network connections, listening services, and active sockets using netstat or ss. Reveals suspicious outbound connections, unusual listening ports, and active network exposure.';
    schema = {
        type: 'object',
        properties: {
            filter: { type: 'string', description: 'Optional: filter keyword to grep from output (e.g. "LISTEN", "ESTABLISHED", a port number).' }
        },
        additionalProperties: false
    };

    async execute(args: { filter?: string }): Promise<string> {
        const filter = args.filter?.trim() || '';

        // Try ss (Linux), then netstat (cross-platform)
        let result = await shell('ss -tulnp');
        if (!result.trim() || result.includes('not found') || result.includes('not recognized')) {
            result = await shell('netstat -tulnp 2>/dev/null || netstat -ano');
        }

        if (filter) {
            const lines = result.split('\n').filter(l => l.toLowerCase().includes(filter.toLowerCase()));
            result = lines.length > 0 ? lines.join('\n') : `No entries matching '${filter}' found.`;
        }

        return `[NETWORK AUDIT] Active connections and listeners:\n${result || 'No data returned.'}`;
    }
}

// ─── 4. File Integrity Checker ──────────────────────────────────────────────
export class FileIntegrityTool implements Tool {
    name = 'file_integrity';
    description = 'Compute SHA-256 hashes of files in a target directory to detect tampering, unauthorized modifications, or planted malware. Returns a sorted hash manifest for comparison.';
    schema = {
        type: 'object',
        properties: {
            targetPath: { type: 'string', description: 'Absolute or relative path of the file or directory to hash.' },
            recursive: { type: 'boolean', description: 'If true, recursively scan all files in subdirectories.' }
        },
        required: ['targetPath'],
        additionalProperties: false
    };

    async execute(args: { targetPath: string; recursive?: boolean }): Promise<string> {
        const target = path.resolve(args.targetPath);
        const recursive = args.recursive ?? false;

        if (!fs.existsSync(target)) {
            return `[FILE INTEGRITY ERROR]: Path does not exist: ${target}`;
        }

        const stat = fs.statSync(target);

        const hashFile = (filePath: string): string => {
            try {
                const content = fs.readFileSync(filePath);
                const hash = crypto.createHash('sha256').update(content).digest('hex');
                return `${hash}  ${filePath}`;
            } catch (e: any) {
                return `ERROR reading ${filePath}: ${e.message}`;
            }
        };

        if (stat.isFile()) {
            return `[FILE INTEGRITY]:\n${hashFile(target)}`;
        }

        // Directory scan
        const getFiles = (dir: string): string[] => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const files: string[] = [];
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isFile()) {
                    files.push(full);
                } else if (entry.isDirectory() && recursive) {
                    files.push(...getFiles(full));
                }
            }
            return files;
        };

        const files = getFiles(target);
        if (files.length === 0) {
            return `[FILE INTEGRITY]: No files found in ${target}`;
        }

        const hashes = files.map(hashFile).sort();
        return `[FILE INTEGRITY] SHA-256 manifest for ${target}:\n${truncate(hashes.join('\n'), MAX_OUT)}`;
    }
}

// ─── 5. Process Inspector ───────────────────────────────────────────────────
export class ProcessInspectorTool implements Tool {
    name = 'process_inspect';
    description = 'List all running system processes with their PID, CPU, memory usage, and command name. Useful for detecting suspicious processes, rootkits, or unauthorized background services.';
    schema = {
        type: 'object',
        properties: {
            filter: { type: 'string', description: 'Optional keyword to filter process names (e.g. "node", "python").' }
        },
        additionalProperties: false
    };

    async execute(args: { filter?: string }): Promise<string> {
        const filter = args.filter?.toLowerCase().trim() || '';

        // Try cross-platform commands
        let result = await shell('ps aux --sort=-%cpu 2>/dev/null || tasklist /fo list');
        
        if (filter) {
            const lines = result.split('\n');
            const header = lines[0];
            const filtered = lines.slice(1).filter(l => l.toLowerCase().includes(filter));
            result = [header, ...filtered].join('\n');
        }

        return `[PROCESS INSPECTOR]:\n${result || 'No process data returned.'}`;
    }
}

// ─── 6. Environment Secrets Scanner ─────────────────────────────────────────
export class EnvSecretsScannerTool implements Tool {
    name = 'env_secrets_scan';
    description = 'Scan .env files and environment variables in a directory for exposed secrets, API keys, passwords, and tokens. Identifies dangerous patterns without exposing the actual secret values.';
    schema = {
        type: 'object',
        properties: {
            targetPath: { type: 'string', description: 'Directory path to scan for .env files and config files.' }
        },
        required: ['targetPath'],
        additionalProperties: false
    };

    async execute(args: { targetPath: string }): Promise<string> {
        const target = path.resolve(args.targetPath);
        if (!fs.existsSync(target)) {
            return `[SECRETS SCAN ERROR]: Path does not exist: ${target}`;
        }

        const dangerousPatterns: Array<{ name: string; regex: RegExp }> = [
            { name: 'AWS Access Key',       regex: /AKIA[0-9A-Z]{16}/g },
            { name: 'Generic API Key',      regex: /api[_-]?key\s*=\s*["']?[a-z0-9\-_]{20,}/gi },
            { name: 'Private Key Header',   regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
            { name: 'Password in .env',     regex: /^(DB_PASS|MYSQL_PASS|POSTGRES_PASS|PASSWORD|SECRET)\s*=\s*.+$/gim },
            { name: 'Bearer Token',         regex: /bearer\s+[a-z0-9\-._~+\/]+=*/gi },
            { name: 'JWT Token',            regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
            { name: 'OpenAI Key',           regex: /sk-(or-v1-|proj-)?[a-zA-Z0-9]{20,}/g },
            { name: 'GitHub Token',         regex: /gh[pousr]_[A-Za-z0-9_]{36}/g },
        ];

        const scanFile = (filePath: string): string[] => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const findings: string[] = [];
                for (const { name, regex } of dangerousPatterns) {
                    const matches = content.match(regex);
                    if (matches) {
                        findings.push(`  ⚠️  ${name} detected in: ${filePath} (${matches.length} occurrence(s))`);
                    }
                }
                return findings;
            } catch {
                return [];
            }
        };

        const sensitiveFiles = ['.env', '.env.local', '.env.production', 'config.json', 'secrets.json', '.npmrc', '.netrc'];
        const getAllFiles = (dir: string, depth = 0): string[] => {
            if (depth > 4) return [];
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const files: string[] = [];
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                const full = path.join(dir, entry.name);
                if (entry.isFile() && sensitiveFiles.includes(entry.name)) {
                    files.push(full);
                } else if (entry.isDirectory()) {
                    files.push(...getAllFiles(full, depth + 1));
                }
            }
            return files;
        };

        const filesToScan = getAllFiles(target);
        if (filesToScan.length === 0) {
            return `[SECRETS SCAN]: No sensitive configuration files found in ${target}`;
        }

        const allFindings: string[] = [];
        for (const f of filesToScan) {
            allFindings.push(...scanFile(f));
        }

        if (allFindings.length === 0) {
            return `[SECRETS SCAN] ✅ No dangerous secret patterns detected in ${filesToScan.length} file(s) scanned.`;
        }

        return `[SECRETS SCAN] 🚨 Potential secrets found:\n${allFindings.join('\n')}\n\nFiles scanned: ${filesToScan.length}`;
    }
}
