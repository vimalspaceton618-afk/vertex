import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OPS_DIR = path.join(os.homedir(), '.vertex', 'ops');
const STATE_FILE = path.join(OPS_DIR, 'engagement.json');

export type CompromisedHost = {
    hostname: string;
    ip: string;
    os?: string;
    accessLevel: 'user' | 'admin' | 'system' | 'root' | 'domain_admin';
    method: string;
    compromisedAt: string;
    lastVerified: string;
    notes?: string;
};

export type PivotPath = {
    id: string;
    fromHost: string;
    toHost: string;
    method: 'smb' | 'winrm' | 'ssh' | 'rdp' | 'wmi' | 'psexec' | 'dcom' | 'socks' | 'port_forward' | 'other';
    port?: number;
    credentials?: string;
    status: 'active' | 'tested' | 'theoretical';
    createdAt: string;
};

export type StagedPayload = {
    id: string;
    name: string;
    targetHost: string;
    payloadType: string;
    filePath?: string;
    hash?: string;
    staged: boolean;
    deployed: boolean;
    createdAt: string;
};

export type EngagementTarget = {
    identifier: string;
    type: 'ip' | 'cidr' | 'domain' | 'hostname' | 'url';
    status: 'queued' | 'scanning' | 'enumerated' | 'exploiting' | 'compromised' | 'post_exploit' | 'done';
    services?: { port: number; protocol: string; service: string; version?: string }[];
    addedAt: string;
    updatedAt: string;
    notes?: string;
};

export type EngagementState = {
    engagementId: string;
    name: string;
    startedAt: string;
    updatedAt: string;
    status: 'active' | 'paused' | 'completed';
    targets: EngagementTarget[];
    compromised: CompromisedHost[];
    pivots: PivotPath[];
    payloads: StagedPayload[];
    timeline: TimelineEvent[];
};

export type TimelineEvent = {
    timestamp: string;
    phase: string;
    action: string;
    target?: string;
    result: 'success' | 'failure' | 'info';
    detail?: string;
};

function ensureDir(): void {
    if (!fs.existsSync(OPS_DIR)) {
        fs.mkdirSync(OPS_DIR, { recursive: true, mode: 0o700 });
    }
}

function genId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyState(): EngagementState {
    return {
        engagementId: genId(),
        name: 'default',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        targets: [],
        compromised: [],
        pivots: [],
        payloads: [],
        timeline: []
    };
}

export class SessionManager {
    private state: EngagementState;

    constructor() {
        this.state = this.load();
    }

    private load(): EngagementState {
        ensureDir();
        if (!fs.existsSync(STATE_FILE)) return emptyState();
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch {
            return emptyState();
        }
    }

    private save(): void {
        ensureDir();
        this.state.updatedAt = new Date().toISOString();
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    }

    private addTimeline(phase: string, action: string, result: TimelineEvent['result'], target?: string, detail?: string): void {
        this.state.timeline.push({
            timestamp: new Date().toISOString(),
            phase, action, target, result, detail
        });
        if (this.state.timeline.length > 500) {
            this.state.timeline = this.state.timeline.slice(-500);
        }
    }

    newEngagement(name: string): string {
        this.state = emptyState();
        this.state.name = name;
        this.addTimeline('setup', 'Engagement created', 'info', undefined, name);
        this.save();
        return this.state.engagementId;
    }

    addTarget(target: Omit<EngagementTarget, 'addedAt' | 'updatedAt' | 'status'>): void {
        const existing = this.state.targets.find(t => t.identifier === target.identifier);
        if (existing) {
            existing.updatedAt = new Date().toISOString();
            if (target.notes) existing.notes = target.notes;
        } else {
            this.state.targets.push({
                ...target,
                status: 'queued',
                addedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        this.addTimeline('recon', `Target added: ${target.identifier}`, 'info', target.identifier);
        this.save();
    }

    updateTargetStatus(identifier: string, status: EngagementTarget['status'], services?: EngagementTarget['services']): void {
        const target = this.state.targets.find(t => t.identifier === identifier);
        if (!target) return;
        target.status = status;
        target.updatedAt = new Date().toISOString();
        if (services) target.services = services;
        this.addTimeline('recon', `Target ${identifier} → ${status}`, 'info', identifier);
        this.save();
    }

    markCompromised(host: Omit<CompromisedHost, 'compromisedAt' | 'lastVerified'>): void {
        const existing = this.state.compromised.find(c => c.ip === host.ip || c.hostname === host.hostname);
        if (existing) {
            existing.accessLevel = host.accessLevel;
            existing.lastVerified = new Date().toISOString();
            if (host.notes) existing.notes = host.notes;
        } else {
            this.state.compromised.push({
                ...host,
                compromisedAt: new Date().toISOString(),
                lastVerified: new Date().toISOString()
            });
        }
        this.addTimeline('exploitation', `Host compromised: ${host.hostname || host.ip} (${host.accessLevel})`, 'success', host.ip, host.method);
        this.save();
    }

    addPivot(pivot: Omit<PivotPath, 'id' | 'createdAt'>): string {
        const id = genId();
        this.state.pivots.push({ ...pivot, id, createdAt: new Date().toISOString() });
        this.addTimeline('lateral_movement', `Pivot: ${pivot.fromHost} → ${pivot.toHost} via ${pivot.method}`, 'info', pivot.toHost);
        this.save();
        return id;
    }

    stagePayload(payload: Omit<StagedPayload, 'id' | 'createdAt' | 'staged' | 'deployed'>): string {
        const id = genId();
        this.state.payloads.push({ ...payload, id, staged: true, deployed: false, createdAt: new Date().toISOString() });
        this.addTimeline('execution', `Payload staged: ${payload.name} → ${payload.targetHost}`, 'info', payload.targetHost);
        this.save();
        return id;
    }

    markPayloadDeployed(id: string): boolean {
        const payload = this.state.payloads.find(p => p.id === id);
        if (!payload) return false;
        payload.deployed = true;
        this.addTimeline('execution', `Payload deployed: ${payload.name}`, 'success', payload.targetHost);
        this.save();
        return true;
    }

    getAttackSurface(): string {
        const lines: string[] = ['[ATTACK SURFACE]'];
        lines.push(`\nEngagement: ${this.state.name} (${this.state.status})`);
        lines.push(`Started: ${this.state.startedAt}`);

        lines.push(`\nTargets (${this.state.targets.length}):`);
        for (const t of this.state.targets) {
            const svcCount = t.services?.length || 0;
            lines.push(`  ${t.identifier} [${t.type}] — ${t.status} — ${svcCount} services`);
        }

        lines.push(`\nCompromised (${this.state.compromised.length}):`);
        for (const c of this.state.compromised) {
            lines.push(`  ${c.hostname || c.ip} — ${c.accessLevel} — via ${c.method}`);
        }

        lines.push(`\nPivots (${this.state.pivots.length}):`);
        for (const p of this.state.pivots) {
            lines.push(`  ${p.fromHost} → ${p.toHost} [${p.method}] — ${p.status}`);
        }

        lines.push(`\nPayloads (${this.state.payloads.length}):`);
        for (const p of this.state.payloads) {
            lines.push(`  ${p.name} → ${p.targetHost} — staged:${p.staged} deployed:${p.deployed}`);
        }

        return lines.join('\n');
    }

    exportTimeline(): string {
        const lines: string[] = ['[ENGAGEMENT TIMELINE]', ''];
        for (const e of this.state.timeline) {
            lines.push(`${e.timestamp} | ${e.phase.padEnd(18)} | ${e.result.padEnd(7)} | ${e.action}${e.target ? ' [' + e.target + ']' : ''}${e.detail ? ' — ' + e.detail : ''}`);
        }
        return lines.join('\n');
    }

    getState(): EngagementState {
        return structuredClone(this.state);
    }

    destroy(): void {
        if (fs.existsSync(STATE_FILE)) {
            fs.writeFileSync(STATE_FILE, '{}', { mode: 0o600 });
            fs.unlinkSync(STATE_FILE);
        }
        this.state = emptyState();
    }
}

let instance: SessionManager | null = null;
export function getSessionManager(): SessionManager {
    if (!instance) instance = new SessionManager();
    return instance;
}
