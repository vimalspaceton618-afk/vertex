import { AttackPhase } from './AttackGraph.js';

export interface ReportStats {
    totalFindings: number;
    totalCredentials: number;
    totalPayloads: number;
    phasesCompleted: number;
    durationMs: number;
}

export interface TargetProfile {
    targetId: string; // IP or hostname
    os?: 'windows' | 'linux' | 'darwin' | 'unknown';
    openPorts: number[];
    services: { port: number; name: string; version: string }[];
    vulnerabilities: string[];
    credentialsFound: boolean;
    lastSeen: number;
}

export interface EngagementReplay {
    replayId: string;
    timestamp: number;
    target: string;
    successfulChain: {
        phase: AttackPhase;
        toolUsed: string;
        command: string;
        resultSummary: string;
    }[];
}

export class SessionManager {
    private sessionId: string;
    private startTime: number;
    private targetProfiles: Map<string, TargetProfile> = new Map();
    private engagementReplays: EngagementReplay[] = [];
    private logs: { timestamp: number; level: 'info' | 'warn' | 'error'; message: string }[] = [];

    constructor() {
        this.sessionId = 'VERTEX-' + Math.random().toString(36).substring(2, 9).toUpperCase();
        this.startTime = Date.now();
    }

    log(level: 'info' | 'warn' | 'error', message: string): void {
        this.logs.push({ timestamp: Date.now(), level, message });
        // Also write to stdout in real implementation
        if (process.env.DEBUG === 'true' || level === 'error') {
            console[level](`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
        }
    }

    getSessionId(): string {
        return this.sessionId;
    }

    getUptimeMs(): number {
        return Date.now() - this.startTime;
    }

    updateTargetProfile(targetId: string, updates: Partial<TargetProfile>): void {
        let profile = this.targetProfiles.get(targetId);
        if (!profile) {
            profile = { targetId, openPorts: [], services: [], vulnerabilities: [], credentialsFound: false, lastSeen: Date.now() };
        }
        
        if (updates.os) profile.os = updates.os;
        if (updates.openPorts) {
            profile.openPorts = [...new Set([...profile.openPorts, ...updates.openPorts])].sort((a, b) => a - b);
        }
        if (updates.services) {
            // merge services, overwrite if same port
            for (const s of updates.services) {
                const existing = profile.services.findIndex(x => x.port === s.port);
                if (existing >= 0) profile.services[existing] = s;
                else profile.services.push(s);
            }
        }
        if (updates.vulnerabilities) {
            profile.vulnerabilities = [...new Set([...profile.vulnerabilities, ...updates.vulnerabilities])];
        }
        if (updates.credentialsFound !== undefined) profile.credentialsFound = updates.credentialsFound;
        
        profile.lastSeen = Date.now();
        this.targetProfiles.set(targetId, profile);
        this.log('info', `Updated profile for target: ${targetId}`);
    }

    getTargetProfile(targetId: string): TargetProfile | undefined {
        return this.targetProfiles.get(targetId);
    }

    getAllTargetProfiles(): TargetProfile[] {
        return Array.from(this.targetProfiles.values());
    }

    recordEngagementReplay(target: string, chain: { phase: AttackPhase; toolUsed: string; command: string; resultSummary: string }[]): string {
        const replay: EngagementReplay = {
            replayId: 'REPLAY-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
            timestamp: Date.now(),
            target,
            successfulChain: chain
        };
        this.engagementReplays.push(replay);
        this.log('info', `Recorded engagement replay ${replay.replayId} for ${target} with ${chain.length} steps`);
        return replay.replayId;
    }

    getEngagementReplays(): EngagementReplay[] {
        return [...this.engagementReplays];
    }

    exportReport(stats: ReportStats): string {
        const report = [
            `=========================================`,
            `      VERTEX SESSION REPORT              `,
            `=========================================`,
            `Session ID: ${this.sessionId}`,
            `Uptime:     ${(this.getUptimeMs() / 1000).toFixed(1)}s`,
            ``,
            `-- STATISTICS --`,
            `Findings:    ${stats.totalFindings}`,
            `Credentials: ${stats.totalCredentials}`,
            `Payloads:    ${stats.totalPayloads}`,
            `Phases Hit:  ${stats.phasesCompleted} / 14`,
            ``,
            `-- TARGET PROFILES --`,
            ...this.getAllTargetProfiles().map(tp => 
                `  Target: ${tp.targetId} (${tp.os || 'unknown'})\n` +
                `    Ports: ${tp.openPorts.join(', ')}\n` +
                `    Vulns: ${tp.vulnerabilities.length}\n` +
                `    Creds: ${tp.credentialsFound ? 'YES' : 'NO'}`
            ),
            ``,
            `-- REPLAYS AVAILABLE --`,
            ...this.engagementReplays.map(r => `  [${r.replayId}] ${r.target} (${r.successfulChain.length} steps)`),
            ``,
            `-- ERROR LOGS --`,
            ...this.logs.filter(l => l.level === 'error').map(l => `  [${new Date(l.timestamp).toISOString()}] ${l.message}`),
            `=========================================`
        ];

        return report.join('\n');
    }
}

let instance: SessionManager | null = null;
export function getSessionManager(): SessionManager {
    if (!instance) instance = new SessionManager();
    return instance;
}
