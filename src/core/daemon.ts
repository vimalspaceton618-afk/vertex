import http from 'http';
import { AgentManager } from './agent/AgentManager.js';

let orchestrator: AgentManager | null = null;

export function getOrchestrator(): AgentManager {
    if (!orchestrator) {
        orchestrator = new AgentManager();
    }
    return orchestrator;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'running', pid: process.pid }));
        return;
    }

    if (url.pathname === '/run' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { prompt, autoApprove } = JSON.parse(body);
                res.writeHead(200, {
                    'Content-Type': 'text/plain',
                    'Transfer-Encoding': 'chunked',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

                const manager = getOrchestrator();
                // Simple confirmation handler in daemon mode
                const confirm = async (msg: string) => {
                    return Boolean(autoApprove);
                };

                const stream = manager.delegateTask(prompt, confirm);
                for await (const chunk of stream) {
                    res.write(chunk);
                }
                res.end();
            } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`[DAEMON ERROR]: ${e.message}`);
            }
        });
        return;
    }

    res.writeHead(404);
    res.end();
});

export function startDaemon(port = 8899) {
    server.listen(port, '127.0.0.1', () => {
        console.log(`[DAEMON]: Server running at http://127.0.0.1:${port}`);
    });
}
