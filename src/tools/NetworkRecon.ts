import { Tool } from './Tool.js';
import * as net from 'net';
import * as dgram from 'dgram';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { execFile } from 'child_process';

const MAX_OUT = 8000;
function truncate(s: string, max = MAX_OUT): string {
    return s.length > max ? s.slice(0, max) + '\n[TRUNCATED]' : s;
}

function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function parsePorts(portSpec: string): number[] {
    const ports: Set<number> = new Set();
    for (const part of portSpec.split(',')) {
        const trimmed = part.trim();
        if (trimmed.includes('-')) {
            const [a, b] = trimmed.split('-').map(Number);
            if (!isNaN(a) && !isNaN(b)) {
                for (let p = Math.max(1, a); p <= Math.min(65535, b); p++) ports.add(p);
            }
        } else {
            const p = Number(trimmed);
            if (!isNaN(p) && p >= 1 && p <= 65535) ports.add(p);
        }
    }
    return Array.from(ports);
}

// ─── 1. TCP Connect Scanner ────────────────────────────────────────────────────
export class TcpScanTool implements Tool {
    name = 'tcp_scan';
    description = 'Native TCP connect scanner with banner grabbing. Scans ports in randomized order with configurable concurrency.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target IP or hostname' },
            ports: { type: 'string', description: 'Port specification: "80,443,8080" or "1-1024" or "21-25,80,443,3306,8080"' },
            timeout: { type: 'number', description: 'Timeout per port in ms (default 2000)' },
            concurrency: { type: 'number', description: 'Max concurrent connections (default 100)' }
        },
        required: ['target', 'ports'],
        additionalProperties: false
    };

    async execute(args: { target: string; ports: string; timeout?: number; concurrency?: number }): Promise<string> {
        const timeout = args.timeout ?? 2000;
        const concurrency = Math.min(args.concurrency ?? 100, 500);
        const ports = shuffle(parsePorts(args.ports));

        if (ports.length === 0) return '[TCP SCAN ERROR]: No valid ports specified.';
        if (ports.length > 10000) return '[TCP SCAN ERROR]: Port range too large (max 10000).';

        const results: { port: number; status: string; banner?: string }[] = [];
        let idx = 0;

        const scanPort = (port: number): Promise<void> => new Promise(resolve => {
            const sock = new net.Socket();
            let banner = '';
            sock.setTimeout(timeout);

            sock.on('connect', () => {
                sock.setTimeout(1000);
            });
            sock.on('data', (data) => {
                banner += data.toString('utf-8', 0, Math.min(data.length, 256));
                sock.destroy();
            });
            sock.on('timeout', () => {
                if (sock.connecting) {
                    sock.destroy();
                } else {
                    // Connected but no banner within timeout
                    results.push({ port, status: 'open', banner: banner || undefined });
                    sock.destroy();
                    resolve();
                    return;
                }
            });
            sock.on('close', () => {
                if (banner) results.push({ port, status: 'open', banner });
                resolve();
            });
            sock.on('error', (err: any) => {
                if (err.code === 'ECONNREFUSED') {
                    // closed
                } else if (err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
                    // filtered
                }
                sock.destroy();
                resolve();
            });

            sock.connect(port, args.target, () => {
                results.push({ port, status: 'open', banner: '' });
                // wait briefly for banner
                setTimeout(() => {
                    if (!banner) sock.destroy();
                }, 800);
            });
        });

        // Batch execution
        const batches = Math.ceil(ports.length / concurrency);
        for (let b = 0; b < batches; b++) {
            const batch = ports.slice(b * concurrency, (b + 1) * concurrency);
            await Promise.all(batch.map(p => scanPort(p)));
        }

        // Deduplicate
        const seen = new Set<number>();
        const deduped = results.filter(r => {
            if (seen.has(r.port)) return false;
            seen.add(r.port);
            return true;
        }).sort((a, b) => a.port - b.port);

        if (deduped.length === 0) {
            return `[TCP SCAN] ${args.target}: No open ports found in ${ports.length} ports scanned.`;
        }

        const lines = [`[TCP SCAN] ${args.target} — ${deduped.length} open port(s) / ${ports.length} scanned`, ''];
        for (const r of deduped) {
            const bannerText = r.banner?.trim() ? ` | ${r.banner.trim().slice(0, 100)}` : '';
            lines.push(`  ${r.port}/tcp  open${bannerText}`);
        }
        return truncate(lines.join('\n'));
    }
}

// ─── 2. UDP Probe ───────────────────────────────────────────────────────────────
export class UdpProbeTool implements Tool {
    name = 'udp_probe';
    description = 'UDP service probing for common services (DNS, SNMP, NTP, TFTP) using protocol-specific probes.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target IP or hostname' },
            ports: { type: 'string', description: 'Comma-separated UDP ports (default: "53,123,161,69")' }
        },
        required: ['target'],
        additionalProperties: false
    };

    async execute(args: { target: string; ports?: string }): Promise<string> {
        const portList = parsePorts(args.ports || '53,123,161,69');
        const probes: Record<number, Buffer> = {
            53: Buffer.from([0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x04, 0x62, 0x69, 0x6e, 0x64, 0x00, 0x00, 0x10, 0x00, 0x03]),
            123: Buffer.from([0xe3, 0x00, 0x04, 0xfa, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc5, 0x4f, 0x23, 0x4b, 0x71, 0xb1, 0x52, 0xf8]),
            161: Buffer.from([0x30, 0x26, 0x02, 0x01, 0x01, 0x04, 0x06, 0x70, 0x75, 0x62, 0x6c, 0x69, 0x63, 0xa0, 0x19, 0x02, 0x04, 0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0x02, 0x01, 0x00, 0x30, 0x0b, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x05, 0x00]),
            69: Buffer.from([0x00, 0x01, 0x74, 0x65, 0x73, 0x74, 0x00, 0x6e, 0x65, 0x74, 0x61, 0x73, 0x63, 0x69, 0x69, 0x00])
        };

        const results: string[] = [`[UDP PROBE] ${args.target}`, ''];

        for (const port of portList) {
            const probe = probes[port] || Buffer.from('probe');
            try {
                const response = await new Promise<string>((resolve) => {
                    const sock = dgram.createSocket('udp4');
                    const timer = setTimeout(() => { sock.close(); resolve('no response'); }, 3000);
                    sock.on('message', (msg) => {
                        clearTimeout(timer);
                        const hex = msg.toString('hex').slice(0, 64);
                        sock.close();
                        resolve(`response (${msg.length} bytes): ${hex}...`);
                    });
                    sock.on('error', (err) => {
                        clearTimeout(timer);
                        sock.close();
                        resolve(`error: ${err.message}`);
                    });
                    sock.send(probe, port, args.target);
                });
                results.push(`  ${port}/udp  ${response}`);
            } catch (e: any) {
                results.push(`  ${port}/udp  error: ${e.message}`);
            }
        }
        return truncate(results.join('\n'));
    }
}

// ─── 3. HTTP Probe ──────────────────────────────────────────────────────────────
export class HttpProbeTool implements Tool {
    name = 'http_probe';
    description = 'HTTP/HTTPS service fingerprinting — extracts server headers, TLS cert info, technology detection, and response metadata.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL (http:// or https://)' }
        },
        required: ['url'],
        additionalProperties: false
    };

    async execute(args: { url: string }): Promise<string> {
        try {
            const parsed = new URL(args.url);
            const isHttps = parsed.protocol === 'https:';
            const mod = isHttps ? https : http;

            return new Promise<string>((resolve) => {
                const req = mod.request(parsed, { method: 'GET', timeout: 8000, rejectUnauthorized: false } as any, (res) => {
                    const headers = res.headers;
                    const lines = [`[HTTP PROBE] ${args.url}`, ''];
                    lines.push(`Status: ${res.statusCode} ${res.statusMessage}`);
                    lines.push('');
                    lines.push('Headers:');
                    for (const [k, v] of Object.entries(headers)) {
                        lines.push(`  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
                    }

                    // Tech detection from headers
                    const techs: string[] = [];
                    const server = headers['server'];
                    if (server) techs.push(`Server: ${server}`);
                    const powered = headers['x-powered-by'];
                    if (powered) techs.push(`X-Powered-By: ${powered}`);
                    const aspnet = headers['x-aspnet-version'];
                    if (aspnet) techs.push(`ASP.NET: ${aspnet}`);
                    if (headers['x-drupal-cache']) techs.push('CMS: Drupal');
                    if (headers['x-generator']) techs.push(`Generator: ${headers['x-generator']}`);
                    if (headers['x-amz-request-id']) techs.push('Cloud: AWS');
                    if (headers['x-goog-generation']) techs.push('Cloud: GCP');

                    if (techs.length) {
                        lines.push('');
                        lines.push('Technologies:');
                        techs.forEach(t => lines.push(`  ${t}`));
                    }

                    // TLS cert info
                    if (isHttps && (req as any).socket?.getPeerCertificate) {
                        try {
                            const cert = (req as any).socket.getPeerCertificate();
                            if (cert && cert.subject) {
                                lines.push('');
                                lines.push('TLS Certificate:');
                                lines.push(`  Subject: ${JSON.stringify(cert.subject)}`);
                                lines.push(`  Issuer: ${JSON.stringify(cert.issuer)}`);
                                lines.push(`  Valid: ${cert.valid_from} — ${cert.valid_to}`);
                                if (cert.subjectaltname) lines.push(`  SANs: ${cert.subjectaltname}`);
                            }
                        } catch { /* no cert */ }
                    }

                    res.resume();
                    resolve(truncate(lines.join('\n')));
                });
                req.on('timeout', () => { req.destroy(); resolve('[HTTP PROBE ERROR]: Connection timeout'); });
                req.on('error', (e) => resolve(`[HTTP PROBE ERROR]: ${e.message}`));
                req.end();
            });
        } catch (e: any) {
            return `[HTTP PROBE ERROR]: ${e.message}`;
        }
    }
}

// ─── 4. Subdomain Enumeration ───────────────────────────────────────────────────
const SUBDOMAIN_WORDLIST = [
    'www', 'mail', 'ftp', 'localhost', 'webmail', 'smtp', 'pop', 'ns1', 'ns2',
    'ns3', 'ns4', 'imap', 'test', 'dns', 'dns1', 'dns2', 'proxy', 'vpn',
    'admin', 'login', 'portal', 'dev', 'staging', 'stage', 'api', 'app',
    'beta', 'cdn', 'cloud', 'cms', 'dashboard', 'db', 'demo', 'docs',
    'download', 'git', 'grafana', 'help', 'jenkins', 'jira', 'kibana',
    'ldap', 'm', 'media', 'monitor', 'mx', 'mysql', 'new', 'news',
    'office', 'old', 'panel', 'pma', 'phpmyadmin', 'prod', 'redis',
    'remote', 'secure', 'server', 'shop', 'sip', 'ssh', 'ssl', 'static',
    'status', 'store', 'support', 'sync', 'sys', 'tools', 'track',
    'uat', 'web', 'wiki', 'www2', 'intranet', 'internal', 'exchange',
    'backup', 'blog', 'cpanel', 'direct', 'forum', 'gateway', 'host',
    'hub', 'id', 'img', 'info', 'lab', 'link', 'log', 'manage',
    'mobile', 'mx1', 'mx2', 'node', 'origin', 'payment', 'preview',
    'relay', 'repo', 'report', 'sandbox', 'search', 'service', 'sso',
    'stat', 'storage', 'stream', 'time', 'update', 'v1', 'v2', 'video',
    'voip', 'ww', 'xml', 'autodiscover', 'autoconfig'
];

export class SubdomainEnumTool implements Tool {
    name = 'subdomain_enum';
    description = 'DNS brute-force subdomain enumeration with wildcard detection.';
    schema = {
        type: 'object',
        properties: {
            domain: { type: 'string', description: 'Base domain to enumerate (e.g., example.com)' },
            wordlistPath: { type: 'string', description: 'Optional path to custom wordlist file (one subdomain per line)' }
        },
        required: ['domain'],
        additionalProperties: false
    };

    async execute(args: { domain: string; wordlistPath?: string }): Promise<string> {
        let words = [...SUBDOMAIN_WORDLIST];
        if (args.wordlistPath) {
            try {
                const fs = await import('fs');
                const content = fs.readFileSync(args.wordlistPath, 'utf-8');
                words = content.split('\n').map(w => w.trim()).filter(Boolean);
            } catch (e: any) {
                return `[SUBDOMAIN ENUM ERROR]: Cannot read wordlist: ${e.message}`;
            }
        }

        // Wildcard detection
        const wildcardSub = `nonexistent-${crypto.randomBytes(8).toString('hex')}`;
        let wildcardIp: string | null = null;
        try {
            const addrs = await dns.promises.resolve4(`${wildcardSub}.${args.domain}`);
            wildcardIp = addrs[0];
        } catch { /* no wildcard */ }

        const results: { subdomain: string; ips: string[] }[] = [];
        const resolver = new dns.Resolver();
        resolver.setServers(['8.8.8.8', '1.1.1.1']);

        const resolve = async (sub: string): Promise<void> => {
            const fqdn = `${sub}.${args.domain}`;
            try {
                const addrs = await dns.promises.resolve4(fqdn);
                if (wildcardIp && addrs.length === 1 && addrs[0] === wildcardIp) return;
                results.push({ subdomain: fqdn, ips: addrs });
            } catch { /* NXDOMAIN */ }
        };

        // Batch resolve
        const batchSize = 20;
        for (let i = 0; i < words.length; i += batchSize) {
            const batch = words.slice(i, i + batchSize);
            await Promise.all(batch.map(w => resolve(w)));
        }

        const lines = [`[SUBDOMAIN ENUM] ${args.domain} — ${results.length} found / ${words.length} tested`, ''];
        if (wildcardIp) lines.push(`⚠ Wildcard DNS detected: *.${args.domain} → ${wildcardIp} (filtered)\n`);
        for (const r of results.sort((a, b) => a.subdomain.localeCompare(b.subdomain))) {
            lines.push(`  ${r.subdomain.padEnd(40)} ${r.ips.join(', ')}`);
        }
        return truncate(lines.join('\n'));
    }
}

// ─── 5. WHOIS Lookup ────────────────────────────────────────────────────────────
export class WhoisLookupTool implements Tool {
    name = 'whois_lookup';
    description = 'WHOIS query via raw TCP socket to whois servers.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Domain or IP to query' }
        },
        required: ['target'],
        additionalProperties: false
    };

    async execute(args: { target: string }): Promise<string> {
        const whoisServer = net.isIP(args.target) ? 'whois.arin.net' : 'whois.iana.org';

        try {
            const response = await new Promise<string>((resolve, reject) => {
                const sock = new net.Socket();
                let data = '';
                sock.setTimeout(10000);
                sock.connect(43, whoisServer, () => {
                    sock.write(args.target + '\r\n');
                });
                sock.on('data', (chunk) => { data += chunk.toString(); });
                sock.on('end', () => resolve(data));
                sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout')); });
                sock.on('error', (e) => reject(e));
            });

            // Check for referral
            const referMatch = response.match(/refer:\s*(\S+)/i) || response.match(/whois:\s*(\S+)/i);
            if (referMatch && referMatch[1] !== whoisServer) {
                const refResponse = await new Promise<string>((resolve, reject) => {
                    const sock = new net.Socket();
                    let data = '';
                    sock.setTimeout(10000);
                    sock.connect(43, referMatch[1], () => {
                        sock.write(args.target + '\r\n');
                    });
                    sock.on('data', (chunk) => { data += chunk.toString(); });
                    sock.on('end', () => resolve(data));
                    sock.on('timeout', () => { sock.destroy(); reject(new Error('Timeout')); });
                    sock.on('error', (e) => reject(e));
                });
                return truncate(`[WHOIS] ${args.target} (via ${referMatch[1]})\n\n${refResponse}`);
            }

            return truncate(`[WHOIS] ${args.target} (via ${whoisServer})\n\n${response}`);
        } catch (e: any) {
            return `[WHOIS ERROR]: ${e.message}`;
        }
    }
}

// ─── 6. Service Fingerprint ─────────────────────────────────────────────────────
export class ServiceFingerprintTool implements Tool {
    name = 'service_fingerprint';
    description = 'Protocol-aware TCP banner analysis — identifies service type and version from protocol-specific probes.';
    schema = {
        type: 'object',
        properties: {
            target: { type: 'string', description: 'Target IP or hostname' },
            port: { type: 'number', description: 'Port to fingerprint' }
        },
        required: ['target', 'port'],
        additionalProperties: false
    };

    async execute(args: { target: string; port: number }): Promise<string> {
        const probes: { name: string; send?: Buffer; waitFirst?: boolean }[] = [
            { name: 'banner_grab', waitFirst: true },
            { name: 'http', send: Buffer.from(`GET / HTTP/1.1\r\nHost: ${args.target}\r\nConnection: close\r\n\r\n`) },
            { name: 'smtp_ehlo', send: Buffer.from(`EHLO probe\r\n`) },
        ];

        for (const probe of probes) {
            try {
                const banner = await new Promise<string>((resolve, reject) => {
                    const sock = new net.Socket();
                    let data = '';
                    sock.setTimeout(5000);

                    sock.connect(args.port, args.target, () => {
                        if (probe.send && !probe.waitFirst) {
                            sock.write(probe.send);
                        }
                    });

                    sock.on('data', (chunk) => {
                        data += chunk.toString('utf-8', 0, Math.min(chunk.length, 1024));
                        if (data.length > 512) sock.destroy();
                        if (probe.waitFirst && probe.send) {
                            sock.write(probe.send);
                        }
                    });
                    sock.on('end', () => resolve(data));
                    sock.on('timeout', () => { sock.destroy(); resolve(data); });
                    sock.on('error', (e) => reject(e));
                });

                if (banner.trim()) {
                    const service = this.identifyService(banner, args.port);
                    return [
                        `[SERVICE FINGERPRINT] ${args.target}:${args.port}`,
                        `Probe: ${probe.name}`,
                        `Service: ${service}`,
                        `Banner:`,
                        `  ${banner.trim().slice(0, 500)}`
                    ].join('\n');
                }
            } catch { continue; }
        }

        return `[SERVICE FINGERPRINT] ${args.target}:${args.port} — no identifiable service response`;
    }

    private identifyService(banner: string, port: number): string {
        const lower = banner.toLowerCase();
        if (lower.startsWith('ssh-')) return `SSH (${banner.split('\n')[0].trim()})`;
        if (lower.startsWith('220') && (lower.includes('smtp') || lower.includes('mail'))) return `SMTP (${banner.split('\n')[0].trim()})`;
        if (lower.startsWith('220') && lower.includes('ftp')) return `FTP (${banner.split('\n')[0].trim()})`;
        if (lower.includes('http/1.') || lower.includes('http/2')) return `HTTP (${banner.split('\n')[0].trim()})`;
        if (lower.includes('mysql') || banner.charCodeAt(0) === 0x4a || banner.charCodeAt(0) === 0x0a) return 'MySQL/MariaDB';
        if (lower.startsWith('+ok') || lower.startsWith('+err')) return 'POP3';
        if (lower.startsWith('* ok')) return 'IMAP';
        if (lower.includes('redis')) return 'Redis';
        if (lower.includes('postgresql') || lower.includes('pg_hba')) return 'PostgreSQL';
        if (lower.includes('microsoft') && lower.includes('sql')) return 'MSSQL';
        if (lower.includes('elastic')) return 'Elasticsearch';
        if (lower.includes('mongodb') || lower.includes('mongo')) return 'MongoDB';
        return `Unknown (port ${port})`;
    }
}

// ─── 7. ARP Scan ────────────────────────────────────────────────────────────────
export class ArpScanTool implements Tool {
    name = 'arp_scan';
    description = 'Local subnet ARP discovery using OS-native ARP tables.';
    schema = {
        type: 'object',
        properties: {
            interface: { type: 'string', description: 'Optional network interface name' }
        },
        additionalProperties: false
    };

    async execute(args: { interface?: string }): Promise<string> {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'arp' : 'ip';
        const cmdArgs = isWin ? ['-a'] : ['neigh', 'show'];

        return new Promise<string>((resolve) => {
            execFile(cmd, cmdArgs, { timeout: 10000 }, (err, stdout, stderr) => {
                if (err) {
                    // Fallback
                    execFile('arp', ['-a'], { timeout: 10000 }, (err2, stdout2) => {
                        if (err2) return resolve(`[ARP SCAN ERROR]: ${err.message}`);
                        resolve(truncate(`[ARP SCAN] Local ARP Table:\n\n${stdout2}`));
                    });
                    return;
                }
                resolve(truncate(`[ARP SCAN] Local ARP Table:\n\n${stdout}`));
            });
        });
    }
}
