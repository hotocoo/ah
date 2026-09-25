import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { elideOldToolResults, estimateTokens, safeCutIndex } from "../src/agent/context.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import { Agent } from "../src/agent/loop.ts";
import { buildSystemPrompt } from "../src/agent/prompt.ts";
import type { Message, StreamEvent } from "../src/core/types.ts";
import { MockProvider, type MockTurn } from "../src/providers/mock.ts";
import { ProviderError, type Provider } from "../src/providers/provider.ts";
import { costOf } from "../src/telemetry/pricing.ts";
import { ToolRegistry } from "../src/tools/index.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function setup(script: MockTurn[], extra: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ah-agent-"));
  roots.push(root);
  writeFileSync(join(root, "math.ts"), "export const add = (a: number, b: number) => a - b;\n");
  const events: AgentEvent[] = [];
  const provider = new MockProvider({ script });
  const agent = new Agent({
    provider,
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 10,
    maxTokens: 1000,
    pricing: { input: 3, output: 15 },
    onEvent: (e) => events.push(e),
    maxRetries: 2,
    evidenceGate: false,
    ...extra,
  });
  return { root, agent, events };
}

describe("agent loop", () => {
  test("reads, edits, verifies and finishes", async () => {
    const { root, agent, events } = setup([
      { text: "Reading.", toolCalls: [{ name: "read_file", input: { path: "math.ts" } }] },
      { toolCalls: [{ name: "edit_file", input: { path: "math.ts", old_string: "a - b", new_string: "a + b" } }] },
      { toolCalls: [{ name: "bash", input: { command: "grep -c 'a + b' math.ts" } }] },
      { text: "Fixed add() in math.ts; verified with grep." },
    ]);
    const r = await agent.run("fix add");
    expect(r.outcome).toBe("completed");
    expect(r.turns).toBe(4);
    expect(r.toolCalls).toBe(3);
    expect(r.toolErrors).toBe(0);
    expect(r.changedFiles).toEqual(["math.ts"]);
    expect(r.finalText).toContain("Fixed add()");
    expect(readFileSync(join(root, "math.ts"), "utf8")).toContain("a + b");
    expect(r.costUsd).toBeGreaterThan(0);
    expect(r.ttftMs).not.toBeNull();
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run_start");
    expect(types.at(-1)).toBe("run_end");
    expect(types.filter((t) => t === "tool_end")).toHaveLength(3);
    expect(types.filter((t) => t === "model_response")).toHaveLength(4);
    // tool_result must follow its tool_call in history
    const m = agent.messages;
    expect(m[2]!.content[0]).toMatchObject({ type: "tool_result", toolCallId: (m[1]!.content[1] as { id: string }).id });
  });

  test("tool errors are fed back, not thrown", async () => {
    const { agent } = setup([{ toolCalls: [{ name: "read_file", input: { path: "missing.ts" } }] }, { text: "File is missing." }]);
    const r = await agent.run("read missing");
    expect(r.outcome).toBe("completed");
    expect(r.toolErrors).toBe(1);
  });

  test("stops at max_turns", async () => {
    const loop = Array.from({ length: 20 }, () => ({ toolCalls: [{ name: "list_dir", input: {} }] }));
    const { agent } = setup(loop, { maxTurns: 3 });
    const r = await agent.run("loop");
    expect(r.outcome).toBe("max_turns");
    expect(r.turns).toBe(3);
  });

  test("stops on refusal without running tools", async () => {
    const { agent } = setup([{ text: "no", stopReason: "refusal", toolCalls: [{ name: "bash", input: { command: "echo x" } }] }]);
    const r = await agent.run("x");
    expect(r.outcome).toBe("refusal");
    expect(r.toolCalls).toBe(0);
  });

  test("never runs a tool call truncated at max_tokens", async () => {
    const { agent, events } = setup([{ toolCalls: [{ name: "write_file", input: { path: "x", content: "partial" } }], stopReason: "max_tokens" }], { recoveries: false });
    const r = await agent.run("x");
    expect(r.outcome).toBe("max_tokens");
    expect(r.toolCalls).toBe(0);
    expect(events.some((e) => e.type === "retry")).toBe(true);
  });

  test("a tool call cut off at max_tokens is discarded and the model is asked to split the work", async () => {
    const { agent, events } = setup([
      { toolCalls: [{ name: "write_file", input: { path: "big.txt", content: "partial" } }], stopReason: "max_tokens" },
      { toolCalls: [{ name: "write_file", input: { path: "part1.txt", content: "one" } }] },
      { text: "done" },
    ]);
    const r = await agent.run("write a big file");
    expect(r.outcome).toBe("completed");
    expect(r.toolCalls).toBe(1);
    expect(events.find((e) => e.type === "retry")).toMatchObject({ reason: expect.stringContaining("asked to split") });
    expect(JSON.stringify(agent.messages)).toContain("nothing ran and no file changed");
  });

  test("retries transient provider errors with backoff", async () => {
    const provider = new MockProvider({ failTimes: 1 });
    const { agent, events } = setup([], { provider, model: "echo" });
    const r = await agent.run("hello");
    expect(r.outcome).toBe("completed");
    expect(r.finalText).toBe("echo: hello");
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
  });

  test("re-issues a turn on invalid tool JSON, at most twice", async () => {
    let calls = 0;
    const flaky: Provider = {
      key: "flaky",
      kind: "mock",
      capabilities: new MockProvider().capabilities,
      async *stream(): AsyncGenerator<StreamEvent> {
        calls++;
        throw new ProviderError("bad json", "flaky", undefined, true, "invalid_tool_json");
      },
    };
    const { agent } = setup([], { provider: flaky });
    const r = await agent.run("x");
    expect(r.outcome).toBe("error");
    expect(calls).toBe(3);
  });

  test("respects the USD budget", async () => {
    const loop = Array.from({ length: 20 }, () => ({ toolCalls: [{ name: "list_dir", input: {} }] }));
    const { agent } = setup(loop, { budgetUsd: 0.000001 });
    const r = await agent.run("x");
    expect(r.outcome).toBe("budget");
    expect(r.turns).toBe(1);
  });

  test("compacts context by eliding old tool output", async () => {
    const big = `${"y".repeat(99)}\n`.repeat(500);
    const { root, agent, events } = setup([
      { toolCalls: [{ name: "read_file", input: { path: "big.txt" } }] },
      { toolCalls: [{ name: "list_dir", input: {} }] },
      ...Array.from({ length: 6 }, () => ({ toolCalls: [{ name: "list_dir", input: {} }] })),
      { text: "done" },
    ], { contextWindow: 12_000 });
    writeFileSync(join(root, "big.txt"), big);
    const r = await agent.run("x");
    expect(r.outcome).toBe("completed");
    expect(events.some((e) => e.type === "compaction")).toBe(true);
  });

  test("aborts", async () => {
    const ac = new AbortController();
    const provider = new MockProvider({ chunkDelayMs: 50, script: [{ text: "a long answer that streams slowly for a while" }] });
    const { agent } = setup([], { provider, signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    const r = await agent.run("x");
    expect(r.outcome).toBe("aborted");
  });
});

describe("context helpers", () => {
  const msgs: Message[] = [
    { role: "user", content: [{ type: "text", text: "task" }] },
    { role: "assistant", content: [{ type: "tool_call", id: "1", name: "x", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolCallId: "1", content: "r".repeat(10_000) }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    { role: "user", content: [{ type: "text", text: "next" }] },
  ];

  test("safeCutIndex never splits a tool pair", () => {
    expect(safeCutIndex(msgs, 1)).toBe(4);
    expect(safeCutIndex(msgs, 3)).toBe(0); // only cut point at/before index 2 is the start
  });

  test("elide shrinks old tool results", () => {
    const out = elideOldToolResults(msgs, 1);
    expect(estimateTokens(out)).toBeLessThan(estimateTokens(msgs));
    expect((out[2]!.content[0] as { content: string }).content).toContain("elided");
  });

  test("system prompt is stable and lists tools sorted", () => {
    const a = buildSystemPrompt({ root: "/tmp", model: "m", toolNames: ["b", "a"], date: "2026-01-01" });
    const b = buildSystemPrompt({ root: "/tmp", model: "m", toolNames: ["a", "b"], date: "2026-01-01" });
    expect(a).toBe(b);
    expect(a).toContain("Tools: a, b");
  });
});

describe("pricing", () => {
  test("costOf separates cached input", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 0, reasoningTokens: 0 };
    expect(costOf(u, { input: 2, output: 10, cacheRead: 0.2 })).toBeCloseTo(1 + 0.1 + 10);
    expect(costOf(u, undefined)).toBeNull();
    expect(costOf(u, { input: 1 })).toBeNull();
  });
});

describe("empty responses", () => {
  test("an empty model response is an error after retries, never a completed run", async () => {
    const empty: Provider = {
      key: "empty",
      kind: "mock",
      capabilities: new MockProvider().capabilities,
      async *stream(): AsyncGenerator<StreamEvent> {
        yield { type: "done", message: { role: "assistant", content: [] }, stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } };
      },
    };
    const { agent, events } = setup([], { provider: empty, maxRetries: 1 });
    const r = await agent.run("x");
    expect(r.outcome).toBe("error");
    expect(r.error).toMatch(/empty response/);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
  });
});

describe("nudges", () => {
  test("a turn with neither answer nor tool call is nudged, not completed", async () => {
    const { agent, events } = setup([{ text: "" }, { toolCalls: [{ name: "list_dir", input: {} }] }, { text: "done" }]);
    const r = await agent.run("x");
    expect(r.outcome).toBe("completed");
    expect(r.finalText).toBe("done");
    expect(r.toolCalls).toBe(1);
    expect(events.some((e) => e.type === "retry" && e.reason.includes("without an answer"))).toBe(true);
  });
});

describe("server-dropped tool calls", () => {
  test("switches to the text protocol when the server reports tool_use but sends no calls", async () => {
    const { agent, events } = setup([
      { stopReason: "tool_use" },
      { text: '<tool_call>{"name":"list_dir","arguments":{}}</tool_call>' },
      { text: "Listed." },
    ]);
    const r = await agent.run("list");
    expect(r.outcome).toBe("completed");
    expect(r.toolCalls).toBe(1);
    expect(events.some((e) => e.type === "retry" && e.reason.includes("text tool protocol"))).toBe(true);
  });
});

describe("project facts", () => {
  test("detects languages, manifests, test command and installed toolchains", async () => {
    const { projectFacts, renderProjectFacts } = await import("../src/agent/project.ts");
    const root = mkdtempSync(join(tmpdir(), "ah-proj-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts: { test: "bun test" } }));
    writeFileSync(join(root, "bun.lock"), "");
    writeFileSync(join(root, "a.ts"), "export {}");
    const f = projectFacts(root);
    expect(f.languages[0]).toEqual({ name: "TypeScript", files: 1 });
    expect(f.manifests).toEqual(["package.json", "bun.lock"]);
    expect(f.testCommand).toBe("bun run test");
    expect(f.toolchains.some((t) => t.bin === "bun")).toBe(true);
    const text = renderProjectFacts(f);
    expect(text).toContain("Test command: `bun run test`");
    expect(text).toContain("do not search the filesystem");
  });
});

describe("presets", () => {
  test("a preset supplies model, turns and instructions; explicit options win; unknown names are listed", async () => {
    const { defaultConfig } = await import("../src/config.ts");
    const { buildEnvironment, createSession } = await import("../src/app/session.ts");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "ah-preset-"));
    const cfg = { ...defaultConfig(), dataDir: root, runtimes: { endpoints: [], scan: false }, hardwareSampling: { enabled: false, intervalMs: 1000 }, presets: { review: { model: "mock/scripted", maxTurns: 3, mode: "read-only" as const, instructions: "Only review; never edit." } } };
    const env = await buildEnvironment({ cfg, offline: true, live: false });
    const s = await createSession(env, { root, preset: "review", features: { extensions: false, memory: false } });
    expect(s.modelRef).toBe("mock/scripted");
    expect((s.agent as unknown as { o: { system: string } }).o.system).toContain("Only review; never edit.");
    const s2 = await createSession(env, { root, preset: "review", maxTurns: 9, features: { extensions: false, memory: false } });
    expect((s2.agent as unknown as { o: { maxTurns: number } }).o.maxTurns).toBe(9);
    await expect(createSession(env, { root, preset: "nope" })).rejects.toThrow(/unknown preset "nope"; defined: review/);
  });
});

describe("tool-error coaching", () => {
  test("only error classes recurring across runs of the same model become hints", async () => {
    const { Database } = await import("bun:sqlite");
    const { coachingHints, classify } = await import("../src/agent/coaching.ts");
    const db = new Database(":memory:");
    db.run("CREATE TABLE runs (run_id TEXT, provider TEXT, model TEXT, started_at INTEGER)");
    db.run("CREATE TABLE events (run_id TEXT, seq INTEGER, type TEXT, t INTEGER, data TEXT)");
    const ev = (run: string, preview: string) => db.run("INSERT INTO events VALUES (?, 0, 'tool_end', 0, ?)", [run, JSON.stringify({ preview })]);
    for (const [i, m] of ["a", "a", "b"].entries()) db.run("INSERT INTO runs VALUES (?, 'p', ?, ?)", [`r${i}`, m, i]);
    ev("r0", "old_string not found; re-read the file");
    ev("r0", "old_string not found; re-read the file");
    ev("r1", "old_string not found; re-read the file");
    ev("r0", "path escapes workspace: /tmp/x"); // 3 times in one run only: not a pattern
    ev("r0", "path escapes workspace: /tmp/y");
    ev("r0", "path escapes workspace: /tmp/z");
    ev("r2", "old_string not found; re-read the file"); // another model
    expect(coachingHints(db, "p", "a")).toEqual(["When an edit misses, re-read the file first and copy old_string from the fresh output."]);
    expect(coachingHints(db, "p", "b")).toEqual([]);
    expect(classify("edited a.ts (old_string matched after removing copied line numbers or '>' markers; do not include them)")).toBe("copied-prefix");
  });
});
