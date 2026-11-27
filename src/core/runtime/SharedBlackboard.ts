/**
 * Versioned, bounded telemetry blackboard for coordinating in-process agents.
 *
 * Payloads are JSON data and are deep-copied at every public boundary. This is
 * an in-process store; cross-worker transport requires a MessagePort adapter.
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

function assertJsonValue(value: unknown, seen: WeakSet<object>): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") {
        throw new TypeError("Blackboard payload must contain only JSON values");
    }
    if (seen.has(value)) throw new TypeError("Blackboard payload must not contain circular references");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Blackboard payload must contain only plain JSON objects and arrays");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("Blackboard payload must not contain symbol properties");
    }
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (!("value" in descriptor) || descriptor.value === undefined) {
            throw new TypeError("Blackboard payload must not contain accessors or undefined values");
        }
        assertJsonValue(descriptor.value, seen);
    }
    seen.delete(value);
}

function cloneJsonPayload<T>(payload: T, maxBytes: number): T {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("Blackboard payload must be a JSON object");
    }
    assertJsonValue(payload, new WeakSet<object>());
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        throw new Error("Blackboard payload exceeds configured byte limit");
    }
    return JSON.parse(serialized) as T;
}

export class SharedBlackboard {
    private readonly entries = new Map<string, BlackboardMessage>();
    private readonly listeners = new Map<BlackboardTopic, Set<Listener>>();
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
        if (!input || typeof input.agentId !== "string" || !input.agentId.trim()) {
            throw new Error("agentId is required");
        }
        if (!Number.isFinite(input.confidenceScore) || input.confidenceScore < 0 || input.confidenceScore > 1) {
            throw new Error("confidenceScore must be between 0 and 1");
        }
        if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(Date.now() + ttlMs)) {
            throw new Error("ttlMs must be a positive safe integer");
        }
        const payload = cloneJsonPayload(input.payload, this.options.maxPayloadBytes);
        const now = Date.now();
        const message: BlackboardMessage<T> = {
            ...input,
            payload,
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
        return { ...message, payload: cloneJsonPayload(message.payload, this.options.maxPayloadBytes) };
    }

    subscribe(topic: BlackboardTopic, listener: Listener): () => void {
        if (typeof listener !== "function") throw new TypeError("listener must be a function");
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
        if (limit === 0) return [];
        this.pruneExpired(Date.now());
        return [...this.entries.values()]
            .filter(entry => !topic || entry.topic === topic)
            .slice(-limit)
            .map(entry => ({
                ...entry,
                payload: cloneJsonPayload(entry.payload, this.options.maxPayloadBytes)
            }));
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
            try {
                listener({
                    ...message,
                    payload: cloneJsonPayload(message.payload, this.options.maxPayloadBytes)
                });
            } catch {
                // Isolate subscriber failures and mutations from the stored record.
            }
        }
    }
}
