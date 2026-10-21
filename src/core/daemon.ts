import http from 'http';
import { AgentManager } from './agent/AgentManager.js';

let orchestrator: AgentManager | null = null;
let daemonPort = 8899;

const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_DAEMON_PROMPT_CHARS = 20_000;

export type DaemonPayloadValidation =
    | { ok: true; prompt: string }
    | { ok: false; status: 400 | 413; message: string };

/** Validate untrusted JSON before passing a prompt to the agent manager. */
export function validateDaemonPayload(payload: unknown): DaemonPayloadValidation {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, status: 400, message: 'Expected a JSON object.' };
    }

    const prompt = (payload as { prompt?: unknown }).prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return { ok: false, status: 400, message: 'A non-empty string prompt is required.' };
    }
    if (prompt.length > MAX_DAEMON_PROMPT_CHARS) {
        return {
            ok: false,
            status: 413,
            message: `Prompt exceeds the ${MAX_DAEMON_PROMPT_CHARS}-character limit.`
        };
    }

    // Deliberately return only the validated prompt. Fields such as autoApprove
    // from an untrusted request must never become execution-policy inputs.
    return { ok: true, prompt };
}

/**
 * Browser-origin requests to the loopback daemon are only accepted from loopback
 * origins. Requests from local Node clients normally omit Origin.
 */
export function isAllowedDaemonOrigin(origin: string, expectedPort = daemonPort): boolean {
    try {
        const parsed = new URL(origin);
        const host = parsed.hostname.toLowerCase();
        return parsed.protocol === 'http:' &&
            (host === 'localhost' || host === '127.0.0.1') &&
            parsed.port === String(expectedPort) &&
            !parsed.username && !parsed.password;
    } catch {
        return false;
    }
}

export function getOrchestrator(): AgentManager {
    if (!orchestrator) {
        orchestrator = new AgentManager();
    }
    return orchestrator;
}

export const daemonServer = http.createServer(async (req, res) => {
    // Use a fixed base URL: routing must not depend on an untrusted Host header.
    let pathname: string;
    try {
        pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request URL.');
        return;
    }

    if (pathname === '/status' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(JSON.stringify({ status: 'running', pid: process.pid }));
        return;
    }

    if (pathname === '/run' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !isAllowedDaemonOrigin(origin, daemonPort)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Cross-origin daemon requests are not allowed.');
            return;
        }
        const contentType = (req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/json') {
            res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Content-Type must be application/json.');
            return;
        }

        let body = '';
        let bodyBytes = 0;
        let rejected = false;

        req.on('data', (chunk: Buffer | string) => {
            if (rejected) return;
            const chunkText = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            bodyBytes += Buffer.byteLength(chunkText, 'utf8');
            if (bodyBytes > MAX_REQUEST_BYTES) {
                rejected = true;
                res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Request body too large.');
                req.resume();
                return;
            }
            body += chunkText;
        });

        req.on('end', async () => {
            if (rejected || res.destroyed) return;
            try {
                const payload: unknown = JSON.parse(body);
                const validation = validateDaemonPayload(payload);
                if (!validation.ok) {
                    res.writeHead(validation.status, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(validation.message);
                    return;
                }
                const { prompt } = validation;

                res.writeHead(200, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Transfer-Encoding': 'chunked',
                    'Cache-Control': 'no-cache, no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Connection': 'keep-alive'
                });

                const manager = getOrchestrator();
                // Never trust a request-body flag to grant execution approval.
                // Unattended approval is an explicit local process configuration.
                const autoApprove = process.env.VERTEX_DAEMON_AUTO_APPROVE === 'true';
                const confirm = async (_msg: string) => autoApprove;

                const controller = new AbortController();
                const abortOnDisconnect = () => {
                    if (!res.writableFinished && !controller.signal.aborted) controller.abort();
                };
                const onRequestAborted = () => abortOnDisconnect();
                const onResponseClose = () => abortOnDisconnect();
                req.once('aborted', onRequestAborted);
                res.once('close', onResponseClose);
                try {
                    const stream = manager.delegateTask(prompt, confirm, controller.signal);
                    for await (const chunk of stream) {
                        if (controller.signal.aborted || res.destroyed) break;
                        res.write(chunk);
                    }
                    if (!res.destroyed) res.end();
                } finally {
                    req.removeListener('aborted', onRequestAborted);
                    res.removeListener('close', onResponseClose);
                }
            } catch (e: any) {
                if (res.headersSent) {
                    if (!res.destroyed) res.end();
                    return;
                }
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`[DAEMON ERROR]: ${e.message}`);
            }
        });

        req.on('error', () => {
            if (!res.headersSent && !res.destroyed) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Request could not be read.');
            }
        });
        return;
    }

    if (pathname === '/run' && req.method !== 'POST') {
        res.writeHead(405, { 'Allow': 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed.');
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
});

export function startDaemon(port = 8899) {
    daemonPort = port;
    daemonServer.listen(port, '127.0.0.1', () => {
        console.log(`[DAEMON]: Server running at http://127.0.0.1:${port}`);
        if (process.env.VERTEX_DAEMON_AUTO_APPROVE === 'true') {
            console.warn('[DAEMON WARNING]: VERTEX_DAEMON_AUTO_APPROVE is enabled; tool approvals will be automatic.');
        }
    });
}
