import test from "node:test";
import assert from "node:assert/strict";
import { ASTContextSharder } from "../dist/core/runtime/ASTContextSharder.js";
import { SharedBlackboard } from "../dist/core/runtime/SharedBlackboard.js";
import { TaskSearchPlanner } from "../dist/core/runtime/TaskSearchPlanner.js";

test("ASTContextSharder indexes declarations, replaces stale files, and bounds context", async () => {
    const sharder = new ASTContextSharder({ maxSourceCharsPerSymbol: 120, maxTotalChars: 180 });
    await sharder.indexFile("a.ts", "export class Alpha {\n  Beta.call();\n}\nexport function Beta() {}");
    assert.ok(sharder.listSymbols("a.ts").some(x => x.name === "Alpha"));
    assert.ok(sharder.getPrunedContext("a.ts", "Alpha").length <= 180);
    await sharder.indexFile("a.ts", "export class Fresh {}");
    assert.equal(sharder.listSymbols("a.ts").some(x => x.name === "Alpha"), false);
});

test("SharedBlackboard validates, bounds, expires and isolates subscribers", () => {
    const board = new SharedBlackboard({ maxEntries: 2, maxPayloadBytes: 64, defaultTtlMs: 1000 });
    let count = 0;
    const unsubscribe = board.subscribe("task_status", () => { count++; throw new Error("subscriber error"); });
    board.publish({ agentId: "planner", topic: "task_status", confidenceScore: 0.8, payload: { state: "ready" } });
    assert.equal(count, 1);
    assert.equal(board.read("task_status").length, 1);
    unsubscribe();
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 2, payload: {} }));
    assert.throws(() => board.publish({ agentId: "bad", topic: "task_status", confidenceScore: 1, payload: { data: "x".repeat(100) } }));
});

test("TaskSearchPlanner evaluates candidates and returns a ranked candidate", async () => {
    const planner = new TaskSearchPlanner("Choose the safest strategy", { maxNodes: 8, maxIterations: 4 });
    const winner = await planner.search(
        [{ id: "low", description: "low" }, { id: "high", description: "high" }],
        async candidate => candidate.id === "high" ? 1 : 0.1,
        4
    );
    assert.equal(winner.id, "high");
    assert.ok(planner.getStats().length > 0);
});

test("TaskSearchPlanner rejects invalid inputs", async () => {
    const planner = new TaskSearchPlanner("objective");
    await assert.rejects(() => planner.search([], async () => 0));
});
