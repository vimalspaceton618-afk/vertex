/**
 * Small deterministic UCT planner for exploring task strategies.
 *
 * This class scores candidate plans supplied by the caller. It never creates
 * branches, executes commands, or treats a high score as authorization to act.
 */
export interface StrategyCandidate {
    id: string;
    description: string;
    terminal?: boolean;
}

export interface StrategyNode {
    candidate: StrategyCandidate;
    visits: number;
    totalReward: number;
    parent: StrategyNode | null;
    children: StrategyNode[];
}

export interface PlannerOptions {
    explorationConstant: number;
    maxNodes: number;
    maxIterations: number;
}

const DEFAULTS: PlannerOptions = {
    explorationConstant: Math.SQRT2,
    maxNodes: 256,
    maxIterations: 128
};

export class TaskSearchPlanner {
    private readonly root: StrategyNode;
    private readonly options: PlannerOptions;
    private nodes = 1;

    constructor(objective: string, options: Partial<PlannerOptions> = {}) {
        if (!objective.trim()) throw new Error("objective is required");
        this.options = { ...DEFAULTS, ...options };
        if (!Number.isFinite(this.options.explorationConstant) || this.options.explorationConstant < 0) {
            throw new Error("explorationConstant must be non-negative");
        }
        for (const key of ["maxNodes", "maxIterations"] as const) {
            if (!Number.isSafeInteger(this.options[key]) || this.options[key] <= 0) {
                throw new Error(`${key} must be a positive integer`);
            }
        }
        this.root = this.node({ id: "root", description: objective }, null);
    }

    async search(
        candidates: StrategyCandidate[],
        evaluate: (candidate: StrategyCandidate) => Promise<number>,
        iterations = this.options.maxIterations
    ): Promise<StrategyCandidate> {
        if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("At least one candidate is required");
        if (new Set(candidates.map(x => x.id)).size !== candidates.length) throw new Error("Candidate ids must be unique");
        if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > this.options.maxIterations) {
            throw new Error(`iterations must be between 1 and ${this.options.maxIterations}`);
        }

        const candidateMap = new Map(candidates.map(x => [x.id, x]));
        for (let i = 0; i < iterations && this.nodes < this.options.maxNodes; i++) {
            const selected = this.select(this.root);
            const expanded = this.expand(selected, candidates);
            if (!expanded) break;
            let reward = 0;
            try {
                reward = await evaluate(expanded.candidate);
                if (!Number.isFinite(reward)) reward = 0;
                reward = Math.max(0, Math.min(1, reward));
            } catch {
                reward = 0;
            }
            this.backpropagate(expanded, reward);
        }

        const best = [...this.root.children].sort((a, b) =>
            (b.visits - a.visits) ||
            ((b.totalReward / Math.max(1, b.visits)) - (a.totalReward / Math.max(1, a.visits))) ||
            a.candidate.id.localeCompare(b.candidate.id)
        )[0];
        if (!best || !candidateMap.has(best.candidate.id)) throw new Error("Planner did not evaluate a candidate");
        return best.candidate;
    }

    getStats(): Array<{ id: string; visits: number; meanReward: number }> {
        return this.root.children.map(node => ({
            id: node.candidate.id,
            visits: node.visits,
            meanReward: node.visits ? node.totalReward / node.visits : 0
        }));
    }

    private node(candidate: StrategyCandidate, parent: StrategyNode | null): StrategyNode {
        return { candidate, visits: 0, totalReward: 0, parent, children: [] };
    }

    private select(start: StrategyNode): StrategyNode {
        let current = start;
        while (current.children.length > 0 && !current.candidate.terminal) {
            const unvisited = current.children.find(child => child.visits === 0);
            if (unvisited) return unvisited;
            current = current.children.reduce((best, child) =>
                this.uct(child, current) > this.uct(best, current) ? child : best
            );
        }
        return current;
    }

    private expand(parent: StrategyNode, candidates: StrategyCandidate[]): StrategyNode | null {
        const existing = new Set(parent.children.map(child => child.candidate.id));
        const candidate = candidates.find(item => !existing.has(item.id));
        if (!candidate || this.nodes >= this.options.maxNodes) return null;
        const child = this.node(candidate, parent);
        parent.children.push(child);
        this.nodes++;
        return child;
    }

    private uct(child: StrategyNode, parent: StrategyNode): number {
        if (child.visits === 0) return Number.POSITIVE_INFINITY;
        const mean = child.totalReward / child.visits;
        const exploration = this.options.explorationConstant *
            Math.sqrt(Math.log(Math.max(1, parent.visits)) / child.visits);
        return mean + exploration;
    }

    private backpropagate(node: StrategyNode, reward: number): void {
        let current: StrategyNode | null = node;
        while (current) {
            current.visits++;
            current.totalReward += reward;
            current = current.parent;
        }
    }
}
