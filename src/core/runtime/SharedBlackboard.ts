/**
 * Versioned, bounded telemetry blackboard for coordinating in-process agents.
 *
 * This implementation uses an ordinary evented store. It does not pretend that
 * SharedArrayBuffer broadcasts are process-shared RPC; cross-worker transport
 * should be provided by a dedicated MessagePort/worker adapter.
 */
export type BlackboardTopic =
    | "recon"
    | "vulnerability"
    | "patch_payload"
    | "integrity_manifest"
    | "task_status";

export interface BlackboardMessage<T = Record<string, unknown>> {
    id: string;
    agentId: string;
    topic: BlackboardTopic;
    confidenceScore: number;
    payload: T;
    timestamp: number;
    expiresAt?: number;
}

export interface BlackboardOptions {
    maxEntries: number;
    maxPayloadBytes: number;
    defaultTtlMs: number;
}

const DEFAULTS: BlackboardOptions = {
    maxEntries: 2_000,
    maxPayloadBytes: 64 * 1024,
    defaultTtlMs: 5 * 60_000
};

type Listener = (message: BlackboardMessage) => void;

export class SharedBlackboard {
    private readonly entries = new Map<string, BlackboardMessage>();
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly options: BlackboardOptions;
    private sequence = 0;

    constructor(options: Partial<BlackboardOptions> = {}) {
        this.options = { ...DEFAULTS, ...options };
        for (const [key, value] of Object.entries(this.options)) {
            if (!Number.isSafeInteger(value) || value <= 0) {
                throw new Error(`Invalid SharedBlackboard option: ${key}`);
            }
        }
    }

    publish<T extends Record<string, unknown>>(
        input: Omit<BlackboardMessage<T>, "id" | "timestamp" | "expiresAt">,
        ttlMs = this.options.defaultTtlMs
    ): BlackboardMessage<T> {
        if (!input.agentId.trim()) throw new Error("agentId is required");
        if (!Number.isFinite(input.confidenceScore) || input.confidenceScore < 0 || input.confidenceScore > 1) {
            throw new Error("confidenceScore must be between 0 and 1");
        }
        if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be a positive integer");

        const serialized = JSON.stringify(input.payload);
        if (Buffer.byteLength(serialized, "utf8") > this.options.maxPayloadBytes) {
            throw new Error("Blackboard payload exceeds configured byte limit");
        }

        const now = Date.now();
        const message: BlackboardMessage<T> = {
            ...input,
            id: `${now.toString(36)}-${(++this.sequence).toString(36)}`,
            timestamp: now,
            expiresAt: now + ttlMs
        };
        this.pruneExpired(now);
        this.entries.set(message.id, message as BlackboardMessage);
        while (this.entries.size > this.options.maxEntries) {
            const oldest = this.entries.keys().next().value as string | undefined;
            if (!oldest) break;
            this.entries.delete(oldest);
        }
        this.emit(message as BlackboardMessage);
        return message;
    }

    subscribe(topic: BlackboardTopic, listener: Listener): () => void {
        let bucket = this.listeners.get(topic);
        if (!bucket) this.listeners.set(topic, bucket = new Set());
        bucket.add(listener);
        return () => {
            bucket?.delete(listener);
            if (bucket?.size === 0) this.listeners.delete(topic);
        };
    }

    read(topic?: BlackboardTopic, limit = 100): BlackboardMessage[] {
        if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("limit must be a non-negative integer");
        this.pruneExpired(Date.now());
        return [...this.entries.values()]
            .filter(entry => !topic || entry.topic === topic)
            .slice(-limit)
            .map(entry => ({ ...entry, payload: { ...entry.payload } }));
    }

    clear(): void {
        this.entries.clear();
    }

    private pruneExpired(now: number): void {
        for (const [id, entry] of this.entries) {
            if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.entries.delete(id);
        }
    }

    private emit(message: BlackboardMessage): void {
        for (const listener of [...(this.listeners.get(message.topic) ?? [])]) {
            try { listener(message); } catch { /* isolate subscriber failures */ }
        }
    }
}
