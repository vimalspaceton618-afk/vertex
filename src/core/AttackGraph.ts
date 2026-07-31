export type AttackPhase =
    | 'recon'
    | 'weaponization'
    | 'initial_access'
    | 'execution'
    | 'persistence'
    | 'privilege_escalation'
    | 'defense_evasion'
    | 'credential_access'
    | 'discovery'
    | 'lateral_movement'
    | 'collection'
    | 'exfiltration'
    | 'command_and_control'
    | 'impact';

export type NodeStatus = 'unknown' | 'scanned' | 'vulnerable' | 'exploited' | 'owned' | 'pivot_point';

export type AttackNode = {
    id: string;
    label: string;
    type: 'host' | 'service' | 'credential' | 'network_segment' | 'domain' | 'application';
    ip?: string;
    hostname?: string;
    os?: string;
    status: NodeStatus;
    phase: AttackPhase;
    services?: { port: number; name: string; version?: string }[];
    notes?: string;
};

export type AttackEdge = {
    id: string;
    from: string;
    to: string;
    method: string;
    technique?: string;  // MITRE ATT&CK technique ID (e.g., T1059.001)
    confidence: 'confirmed' | 'likely' | 'possible' | 'theoretical';
    credentials?: string;
    established: boolean;
};

export type AttackGraphState = {
    nodes: Map<string, AttackNode>;
    edges: AttackEdge[];
    currentPhase: AttackPhase;
    objectives: string[];
    killChainProgress: Map<AttackPhase, 'not_started' | 'in_progress' | 'completed'>;
};

const PHASE_ORDER: AttackPhase[] = [
    'recon', 'weaponization', 'initial_access', 'execution',
    'persistence', 'privilege_escalation', 'defense_evasion',
    'credential_access', 'discovery', 'lateral_movement',
    'collection', 'exfiltration', 'command_and_control', 'impact'
];

function genEdgeId(): string {
    return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class AttackGraph {
    private state: AttackGraphState;

    constructor() {
        this.state = {
            nodes: new Map(),
            edges: [],
            currentPhase: 'recon',
            objectives: [],
            killChainProgress: new Map(PHASE_ORDER.map(p => [p, 'not_started']))
        };
    }

    addNode(node: AttackNode): void {
        this.state.nodes.set(node.id, node);
    }

    updateNode(id: string, updates: Partial<AttackNode>): boolean {
        const node = this.state.nodes.get(id);
        if (!node) return false;
        Object.assign(node, updates);
        return true;
    }

    addEdge(edge: Omit<AttackEdge, 'id'>): string {
        const id = genEdgeId();
        this.state.edges.push({ ...edge, id });
        return id;
    }

    setPhase(phase: AttackPhase): void {
        this.state.currentPhase = phase;
        this.state.killChainProgress.set(phase, 'in_progress');
    }

    completePhase(phase: AttackPhase): void {
        this.state.killChainProgress.set(phase, 'completed');
        const idx = PHASE_ORDER.indexOf(phase);
        if (idx < PHASE_ORDER.length - 1) {
            this.state.currentPhase = PHASE_ORDER[idx + 1];
        }
    }

    setObjectives(objectives: string[]): void {
        this.state.objectives = objectives;
    }

    getNode(id: string): AttackNode | undefined {
        return this.state.nodes.get(id);
    }

    getNodesByStatus(status: NodeStatus): AttackNode[] {
        return Array.from(this.state.nodes.values()).filter(n => n.status === status);
    }

    getEdgesFrom(nodeId: string): AttackEdge[] {
        return this.state.edges.filter(e => e.from === nodeId);
    }

    getEdgesTo(nodeId: string): AttackEdge[] {
        return this.state.edges.filter(e => e.to === nodeId);
    }

    findPath(fromId: string, toId: string): AttackEdge[] | null {
        const visited = new Set<string>();
        const queue: { nodeId: string; path: AttackEdge[] }[] = [{ nodeId: fromId, path: [] }];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current.nodeId === toId) return current.path;
            if (visited.has(current.nodeId)) continue;
            visited.add(current.nodeId);

            for (const edge of this.getEdgesFrom(current.nodeId)) {
                if (edge.established && !visited.has(edge.to)) {
                    queue.push({ nodeId: edge.to, path: [...current.path, edge] });
                }
            }
        }
        return null;
    }

    suggestPivot(): string[] {
        const suggestions: string[] = [];
        const ownedNodes = this.getNodesByStatus('owned');
        const vulnerableNodes = this.getNodesByStatus('vulnerable');
        const scannedNodes = this.getNodesByStatus('scanned');

        // Suggest paths from owned to vulnerable
        for (const owned of ownedNodes) {
            for (const vuln of vulnerableNodes) {
                const edges = this.state.edges.filter(e => e.from === owned.id && e.to === vuln.id);
                if (edges.length > 0) {
                    suggestions.push(`${owned.label} → ${vuln.label} via ${edges.map(e => e.method).join(', ')} [${edges[0].confidence}]`);
                }
            }
        }

        // Suggest unexplored paths from owned nodes
        for (const owned of ownedNodes) {
            for (const scanned of scannedNodes) {
                const existingEdge = this.state.edges.find(e => e.from === owned.id && e.to === scanned.id);
                if (!existingEdge) {
                    suggestions.push(`[UNEXPLORED] ${owned.label} → ${scanned.label} — needs enumeration`);
                }
            }
        }

        return suggestions;
    }

    planNextPhase(): string {
        const lines: string[] = [`[ATTACK GRAPH — PHASE PLANNING]`];
        lines.push(`Current phase: ${this.state.currentPhase}`);
        lines.push('');

        lines.push('Kill-chain progress:');
        for (const phase of PHASE_ORDER) {
            const status = this.state.killChainProgress.get(phase) || 'not_started';
            const marker = status === 'completed' ? '✅' : status === 'in_progress' ? '🔄' : '⬜';
            lines.push(`  ${marker} ${phase}`);
        }

        lines.push('');
        lines.push('Objectives:');
        for (const obj of this.state.objectives) {
            lines.push(`  • ${obj}`);
        }

        lines.push('');
        const totalNodes = this.state.nodes.size;
        const owned = this.getNodesByStatus('owned').length;
        const vulnerable = this.getNodesByStatus('vulnerable').length;
        const scanned = this.getNodesByStatus('scanned').length;
        lines.push(`Nodes: ${totalNodes} total | ${owned} owned | ${vulnerable} vulnerable | ${scanned} scanned`);
        lines.push(`Edges: ${this.state.edges.length} (${this.state.edges.filter(e => e.established).length} established)`);

        const pivots = this.suggestPivot();
        if (pivots.length > 0) {
            lines.push('');
            lines.push('Suggested pivots:');
            for (const p of pivots.slice(0, 10)) lines.push(`  → ${p}`);
        }

        return lines.join('\n');
    }

    getKillChain(): string {
        const lines: string[] = ['[KILL CHAIN VISUALIZATION]', ''];
        for (const phase of PHASE_ORDER) {
            const status = this.state.killChainProgress.get(phase) || 'not_started';
            const nodesInPhase = Array.from(this.state.nodes.values()).filter(n => n.phase === phase);
            const edgesInPhase = this.state.edges.filter(e => {
                const toNode = this.state.nodes.get(e.to);
                return toNode && toNode.phase === phase;
            });

            if (nodesInPhase.length > 0 || status !== 'not_started') {
                lines.push(`── ${phase.toUpperCase()} [${status}] ──`);
                for (const n of nodesInPhase) {
                    lines.push(`   ${n.label} (${n.status})${n.ip ? ' [' + n.ip + ']' : ''}`);
                }
                for (const e of edgesInPhase) {
                    const from = this.state.nodes.get(e.from);
                    const to = this.state.nodes.get(e.to);
                    lines.push(`   ${from?.label || e.from} → ${to?.label || e.to} [${e.method}] ${e.established ? '✓' : '?'}`);
                }
                lines.push('');
            }
        }
        return lines.join('\n');
    }

    exportGraph(): { nodes: AttackNode[]; edges: AttackEdge[]; phase: AttackPhase } {
        return {
            nodes: Array.from(this.state.nodes.values()),
            edges: this.state.edges,
            phase: this.state.currentPhase
        };
    }

    buildLLMContext(): string {
        const lines: string[] = [
            '[ATTACK GRAPH CONTEXT]',
            `Phase: ${this.state.currentPhase}`,
            `Objectives: ${this.state.objectives.join('; ') || 'none set'}`,
            `Owned: ${this.getNodesByStatus('owned').map(n => n.label).join(', ') || 'none'}`,
            `Vulnerable: ${this.getNodesByStatus('vulnerable').map(n => n.label).join(', ') || 'none'}`,
            `Active pivots: ${this.state.edges.filter(e => e.established).length}`,
        ];

        const pivots = this.suggestPivot();
        if (pivots.length > 0) {
            lines.push(`Next moves: ${pivots.slice(0, 3).join(' | ')}`);
        }

        return lines.join('\n');
    }
}

let instance: AttackGraph | null = null;
export function getAttackGraph(): AttackGraph {
    if (!instance) instance = new AttackGraph();
    return instance;
}
