import test from "node:test";
import assert from "node:assert/strict";
import { ASTContextSharder } from "../dist/core/runtime/ASTContextSharder.js";
import { SharedBlackboard } from "../dist/core/runtime/SharedBlackboard.js";
import { TaskSearchPlanner } from "../dist/core/runtime/TaskSearchPlanner.js";
import { ResilientModelRouter } from "../dist/core/runtime/ResilientModelRouter.js";

test("ASTContextSharder indexes declarations, replaces stale files, and bounds context", async () => {
    const sharder = new ASTContextSharder({ maxSourceCharsPerSymbol: 120, maxTotalChars: 180 });
    await sharder.indexFile("a.ts", "export class Alpha {\n  Beta.call();\n}\nexport function Beta() {}");
    assert.ok(sharder.listSymbols("a.ts").some(x => x.name === "Alpha"));
    assert.ok(sharder.getPrunedContext("a.ts", "Alpha").length <= 180);
    await sharder.indexFile("a.ts", "export class Fresh {}");
    assert.equal(sharder.listSymbols("a.ts").some(x => x.name === "Alpha"), false);
});

test("SharedBlackboard deep-copies payloads across publish, read, and listeners", () => {
    const board = new SharedBlackboard({ maxEntries: 2, maxPayloadBytes: 256, defaultTtlMs: 1000 });
    const original = { nested: { state: "ready" } };
    let delivered;
    board.subscribe("task_status", message => {
        delivered = message;
        message.payload.nested.state = "listener-mutated";
    });
    const published = board.publish({
        agentId: "planner", topic: "task_status", confidenceScore: 0.8, payload: original
    });
    original.nested.state = "caller-mutated";
    published.payload.nested.state = "return-mutated";
    assert.equal(board.read("task_status")[0].payload.nested.state, "ready");
    assert.equal(delivered.payload.nested.state, "listener-mutated");
    assert.deepEqual(board.read("task_status", 0), []);
});

test("SharedBlackboard validates bounds and rejects non-JSON payloads", () => {
    const board = new SharedBlackboard({ maxEntries: 2, maxPayloadBytes: 64, defaultTtlMs: 1000 });
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 2, payload: {} }));
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 1, payload: { data: "x".repeat(100) } }));
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 1, payload: { value: undefined } }));
    const circular = {};
    circular.self = circular;
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 1, payload: circular }));
});

test("TaskSearchPlanner keeps alternatives at the root and selects the highest mean reward", async () => {
    const planner = new TaskSearchPlanner("Choose the safest strategy", { maxNodes: 8, maxIterations: 4 });
    const winner = await planner.search(
        [{ id: "low", description: "low" }, { id: "high", description: "high" }],
        async candidate => candidate.id === "high" ? 1 : 0.1,
        4
    );
    assert.equal(winner.id, "high");
    assert.deepEqual(planner.getStats().map(x => x.id).sort(), ["high", "low"]);
    assert.ok(planner.getStats().every(x => x.visits > 0));
});

test("TaskSearchPlanner rejects invalid inputs and candidate overflow", async () => {
    const planner = new TaskSearchPlanner("objective", { maxNodes: 2 });
    await assert.rejects(() => planner.search([], async () => 0));
    await assert.rejects(() => planner.search([
        { id: "a", description: "A" }, { id: "b", description: "B" }
    ], async () => 0));
});

test("ResilientModelRouter validates route and budget configuration", () => {
    assert.throws(() => new ResilientModelRouter({
        primary: { name: "primary", baseURL: "https://example.test/v1", apiKey: "test", model: "test" },
        maxContextChars: 0
    }));
    assert.throws(() => new ResilientModelRouter({
        primary: { name: "primary", baseURL: "https://example.test/v1", apiKey: "test", model: "test" },
        maxOutputTokens: -1
    }));
});
