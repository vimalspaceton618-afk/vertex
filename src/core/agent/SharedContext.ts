import * as fs from 'fs';
import * as path from 'path';

const MAX_AUDIT_LOG = 1000;

export interface DiscoveryItem {
    type: 'host' | 'port' | 'credential' | 'vulnerability' | 'finding';
    summary: string;
    details?: any;
    timestamp: number;
}

type SessionContext = {
    rollingSummary?: string;
    recentCommands?: string[];
    touchedFiles?: string[];
    lastGitHead?: string;
    lastUserInput?: string;
    lastAssistantOutput?: string;
};

type WorkflowStepStatus = {
    stepId: string;
    status: 'planned' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    updatedAt: string;
    note?: string;
};

type WorkflowRunRecord = {
    runId: string;
    workflowId: string;
    status: string;
    startedAt: string;
    updatedAt: string;
    lastError?: string;
    steps: WorkflowStepStatus[];
};

export class SharedContext {
    private static discoveryFeed: DiscoveryItem[] = [];
    private static toolResultCache: Map<string, { result: string; timestamp: number }> = new Map();

    static getContextFile(): string {
        const baseRoot = process.env.VERTEX_WORKSPACE_ROOT?.trim() || process.cwd();
        return path.join(baseRoot, '.vertex', 'state.json');
    }

    static init() {
        const contextFile = this.getContextFile();
        const dir = path.dirname(contextFile);
        if (fs.existsSync(dir)) {
            try {
                const stat = fs.statSync(dir);
                if (!stat.isDirectory()) {
                    fs.unlinkSync(dir);
                }
            } catch (e) {
                // Ignore stat/unlink errors
            }
        }
        if (!fs.existsSync(contextFile)) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(contextFile, JSON.stringify({}, null, 2), { mode: 0o600 });
            if (process.platform !== 'win32') fs.chmodSync(contextFile, 0o600);
        }
    }

    static get(key: string): any {
        const contextFile = this.getContextFile();
        if (!fs.existsSync(contextFile)) return null;
        try {
            const data = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
            return data[key];
        } catch (e) {
            return null;
        }
    }

    static set(key: string, value: any) {
        const contextFile = this.getContextFile();
        let data: Record<string, any> = {};
        if (fs.existsSync(contextFile)) {
            try {
                data = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
            } catch (e) {
                // Ignore parse errors, rewrite
            }
        }
        data[key] = value;
        fs.mkdirSync(path.dirname(contextFile), { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') fs.chmodSync(path.dirname(contextFile), 0o700);
        fs.writeFileSync(contextFile, JSON.stringify(data, null, 2), { mode: 0o600 });
        // `mode` only affects creation; also tighten permissions on an existing state file.
        if (process.platform !== 'win32') fs.chmodSync(contextFile, 0o600);
    }

    static updateSession(patch: Partial<SessionContext>) {
        const current = (this.get('session') || {}) as SessionContext;
        this.set('session', { ...current, ...patch });
    }

    static appendRecentCommand(command: string) {
        if (!command?.trim()) return;
        const session = (this.get('session') || {}) as SessionContext;
        const prev = session.recentCommands || [];
        const next = [...prev, command].slice(-20);
        this.updateSession({ recentCommands: next });
    }

    static touchFile(filePath: string) {
        if (!filePath?.trim()) return;
        const baseRoot = process.env.VERTEX_WORKSPACE_ROOT?.trim() || process.cwd();
        const normalized = path.resolve(baseRoot, filePath);
        const session = (this.get('session') || {}) as SessionContext;
        const prev = session.touchedFiles || [];
        const next = [...prev.filter((p) => p !== normalized), normalized].slice(-40);
        this.updateSession({ touchedFiles: next });
    }

    static appendAudit(entry: Record<string, any>) {
        const current = (this.get('auditLog') || []) as Record<string, any>[];
        const next = [...current, { ts: new Date().toISOString(), ...entry }].slice(-MAX_AUDIT_LOG);
        this.set('auditLog', next);
    }

    static addDiscovery(item: Omit<DiscoveryItem, 'timestamp'>): void {
        const entry: DiscoveryItem = { ...item, timestamp: Date.now() };
        SharedContext.discoveryFeed.push(entry);
        if (SharedContext.discoveryFeed.length > 100) SharedContext.discoveryFeed.shift();
        SharedContext.appendAudit({ event: 'discovery', type: item.type, summary: item.summary });
    }

    static getDiscoveryFeed(): DiscoveryItem[] {
        return [...SharedContext.discoveryFeed];
    }

    static getCachedToolResult(cacheKey: string, maxAgeMs = 60000): string | null {
        const cached = SharedContext.toolResultCache.get(cacheKey);
        if (!cached) return null;
        if (Date.now() - cached.timestamp > maxAgeMs) {
            SharedContext.toolResultCache.delete(cacheKey);
            return null;
        }
        return cached.result;
    }

    static setCachedToolResult(cacheKey: string, result: string): void {
        SharedContext.toolResultCache.set(cacheKey, { result, timestamp: Date.now() });
    }

    static buildMemoryBlock(): string {
        const session = (this.get('session') || {}) as SessionContext;
        const lines: string[] = [];
        if (session.rollingSummary) lines.push(`- rollingSummary: ${session.rollingSummary}`);
        if (session.lastGitHead) lines.push(`- lastGitHead: ${session.lastGitHead}`);
        if (session.recentCommands?.length) {
            lines.push(`- recentCommands: ${session.recentCommands.slice(-5).join(' | ')}`);
        }
        if (session.touchedFiles?.length) {
            lines.push(`- touchedFiles: ${session.touchedFiles.slice(-8).join(' | ')}`);
        }
        if (SharedContext.discoveryFeed.length) {
            lines.push(`- recentDiscoveries: ${SharedContext.discoveryFeed.slice(-5).map(d => `[${d.type.toUpperCase()}] ${d.summary}`).join(' | ')}`);
        }
        if (!lines.length) return '';
        return `\n\n[SESSION MEMORY]\n${lines.join('\n')}\n[/SESSION MEMORY]\n`;
    }

    static upsertWorkflowRun(record: WorkflowRunRecord) {
        const runs = (this.get('workflowRuns') || []) as WorkflowRunRecord[];
        const existing = runs.find((x) => x.runId === record.runId);
        if (existing) {
            Object.assign(existing, record, { updatedAt: new Date().toISOString() });
        } else {
            runs.push({ ...record, updatedAt: new Date().toISOString() });
        }
        this.set('workflowRuns', runs.slice(-100));
    }

    static updateWorkflowStep(runId: string, step: WorkflowStepStatus) {
        const runs = (this.get('workflowRuns') || []) as WorkflowRunRecord[];
        const run = runs.find((x) => x.runId === runId);
        if (!run) return;
        const existing = run.steps.find((s) => s.stepId === step.stepId);
        if (existing) {
            Object.assign(existing, step, { updatedAt: new Date().toISOString() });
        } else {
            run.steps.push({ ...step, updatedAt: new Date().toISOString() });
        }
        run.updatedAt = new Date().toISOString();
        this.set('workflowRuns', runs.slice(-100));
    }

    static markWorkflowError(runId: string, error: string) {
        const runs = (this.get('workflowRuns') || []) as WorkflowRunRecord[];
        const run = runs.find((x) => x.runId === runId);
        if (!run) return;
        run.status = 'failed';
        run.lastError = error;
        run.updatedAt = new Date().toISOString();
        this.set('workflowRuns', runs.slice(-100));
    }
}
