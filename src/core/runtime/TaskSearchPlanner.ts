/**
 * Bounded UCB strategy selector over caller-supplied candidates.
 *
 * This is a one-level multi-armed bandit: candidates remain alternatives at the
 * root. It never creates branches, executes commands, or grants authorization.
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
        if (typeof objective !== "string" || !objective.trim()) throw new Error("objective is required");
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
        if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
        if (candidates.some(x => !x || typeof x.id !== "string" || !x.id.trim() ||
            typeof x.description !== "string" || !x.description.trim())) {
            throw new Error("Each candidate requires a non-empty id and description");
        }
        if (new Set(candidates.map(x => x.id)).size !== candidates.length) throw new Error("Candidate ids must be unique");
        if (candidates.length > this.options.maxNodes - 1) {
            throw new Error("maxNodes must allow the root plus every candidate");
        }
        if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > this.options.maxIterations) {
            throw new Error(`iterations must be between 1 and ${this.options.maxIterations}`);
        }

        // Each search starts from a clean root so repeated calls do not leak stale arms.
        this.root.children.length = 0;
        this.root.visits = 0;
        this.root.totalReward = 0;
        this.nodes = 1;

        for (let i = 0; i < iterations; i++) {
            let selected = this.root.children.find(child => child.visits === 0);
            if (!selected && this.root.children.length < candidates.length) {
                const next = candidates[this.root.children.length];
                selected = this.node({ ...next }, this.root);
                this.root.children.push(selected);
                this.nodes++;
            }
            if (!selected) {
                selected = this.root.children.reduce((best, child) =>
                    this.uct(child, this.root) > this.uct(best, this.root) ? child : best
                );
            }

            let reward = 0;
            try {
                reward = await evaluate({ ...selected.candidate });
                if (!Number.isFinite(reward)) reward = 0;
                reward = Math.max(0, Math.min(1, reward));
            } catch {
                // A failed evaluation is a zero-reward outcome, not planner success.
                reward = 0;
            }
            this.backpropagate(selected, reward);
        }

        const best = [...this.root.children].sort((a, b) =>
            (b.totalReward / Math.max(1, b.visits)) - (a.totalReward / Math.max(1, a.visits)) ||
            b.visits - a.visits ||
            a.candidate.id.localeCompare(b.candidate.id)
        )[0];
        if (!best) throw new Error("Planner did not evaluate a candidate");
        return { ...best.candidate };
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
