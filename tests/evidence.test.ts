import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../src/agent/events.ts";
import { EvidenceLedger, type Observation } from "../src/agent/evidence.ts";
import { Agent } from "../src/agent/loop.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { MockProvider, type MockTurn } from "../src/providers/mock.ts";
import { ProviderError, type Provider } from "../src/providers/provider.ts";
import { syntaxNote } from "../src/tools/fs.ts";
import { ToolRegistry } from "../src/tools/index.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const obs = (o: Partial<Observation>): Observation => ({ name: "bash", input: {}, summary: "x", isError: false, denied: false, content: "", changedFiles: [], turn: 1, ...o });

describe("evidence ledger", () => {
  test("verdicts follow observed checks, not claims", () => {
    const l = new EvidenceLedger("bun run test");
    expect(l.verdict(true)).toBe("none");
    l.observe(obs({ name: "edit_file", summary: "edit a.ts", changedFiles: ["a.ts"] }));
    expect(l.verdict(true)).toBe("unverified");
    expect(l.unverified()).toEqual({ files: ["a.ts"], lastFailed: false });
    l.observe(obs({ input: { command: "bun run test" }, summary: "$ bun run test", isError: true, content: "$ bun run test\nerror: expected 3 got 2" }));
    expect(l.verdict(true)).toBe("failed");
    l.observe(obs({ name: "edit_file", summary: "edit a.ts", changedFiles: ["a.ts"] }));
    l.observe(obs({ input: { command: "bun run test" }, summary: "$ bun run test" }));
    expect(l.verdict(true)).toBe("verified");
    expect(l.verdict(false)).toBe("failed");
    const lessons = l.lessons("verified");
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.text).toContain('failed with "error: expected 3 got 2"');
    expect(lessons[0]!.text).toContain("Resolved by: edit a.ts");
    expect(l.lessons("unverified")).toEqual([]);
  });

  test("immediate retries teach nothing; non-check shell commands are not evidence", () => {
    const l = new EvidenceLedger();
    l.observe(obs({ name: "edit_file", isError: true, content: "old_string not found" }));
    l.observe(obs({ name: "edit_file", changedFiles: ["b.ts"] }));
    l.observe(obs({ input: { command: "grep -c foo b.ts" } }));
    expect(l.verdict(true)).toBe("unverified");
    expect(l.lessons("verified")).toEqual([]);
    expect(l.isCheck({ name: "bash", input: { command: "cargo test -q" } })).toBe(true);
    expect(l.isCheck({ name: "bash", input: { command: "ls" } })).toBe(false);
  });
});

test("syntaxNote flags broken TS and ignores other files", () => {
  expect(syntaxNote("/x/a.ts", "export const a = (1;")).toContain("syntax error");
  expect(syntaxNote("/x/a.ts", "export const a = 1;")).toBe("");
  expect(syntaxNote("/x/a.md", "(((")).toBe("");
});

function setup(script: MockTurn[], memory?: MemoryStore) {
  const root = mkdtempSync(join(tmpdir(), "ah-evidence-"));
  roots.push(root);
  writeFileSync(join(root, "math.ts"), "export const add = (a: number, b: number) => a - b;\n");
  const events: AgentEvent[] = [];
  const agent = new Agent({
    provider: new MockProvider({ script }),
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 10,
    maxTokens: 1000,
    onEvent: (e) => events.push(e),
    memory: memory ? { store: memory, scopes: [root, "global"] } : undefined,
  });
  return { root, agent, events };
}

describe("evidence gate and memory", () => {
  test("a run that edits without a check is asked to verify once", async () => {
    const { agent, events } = setup([
      { toolCalls: [{ name: "read_file", input: { path: "math.ts" } }] },
      { toolCalls: [{ name: "edit_file", input: { path: "math.ts", old_string: "a - b", new_string: "a + b" } }] },
      { text: "Done." },
      { toolCalls: [{ name: "bash", input: { command: "bun build math.ts --outdir out" } }] },
      { text: "Done, build passes." },
    ]);
    const r = await agent.run("fix add");
    expect(r.outcome).toBe("completed");
    expect(r.verdict).toBe("verified");
    expect(events.filter((e) => e.type === "evidence_gate")).toHaveLength(1);
  });

  test("verified lessons are stored, recalled and reinforced", async () => {
    const mem = new MemoryStore(":memory:");
    const { root, agent } = setup(
      [
        { toolCalls: [{ name: "read_file", input: { path: "math.ts" } }] },
        { toolCalls: [{ name: "bash", input: { command: "bun build missing.ts --outdir out" } }] },
        { toolCalls: [{ name: "write_file", input: { path: "missing.ts", content: "export {};\n" } }] },
        { toolCalls: [{ name: "bash", input: { command: "bun build missing.ts --outdir out" } }] },
        { text: "Build fixed." },
      ],
      mem,
    );
    const r = await agent.run("make the build pass");
    expect(r.verdict).toBe("verified");
    const stored = mem.list([root]);
    expect(stored.some((m) => m.kind === "lesson" && m.text.includes("write missing.ts"))).toBe(true);
    const hit = mem.search("build missing", [root, "global"]);
    expect(hit[0]!.kind).toBe("lesson");
    const before = hit[0]!.trust;
    mem.reinforce([hit[0]!.id], "verified");
    expect(mem.search("build missing", [root])[0]!.trust).toBeGreaterThan(before);
    mem.reinforce([hit[0]!.id], "failed");
    mem.reinforce([hit[0]!.id], "failed");
    expect(mem.search("build missing", [root])[0]!.trust).toBeLessThan(before);
  });
});

test("forced compaction keeps harness evidence above the model's summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "ah-evidence-"));
  roots.push(root);
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
  const mock = new MockProvider({
    script: [
      { toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] },
      { toolCalls: [{ name: "bash", input: { command: "bun build nope.ts --outdir out" } }] },
      { toolCalls: [{ name: "edit_file", input: { path: "a.ts", old_string: "1", new_string: "2" } }] },
      { toolCalls: [{ name: "list_dir", input: {} }] },
      { toolCalls: [{ name: "list_dir", input: {} }] },
      { toolCalls: [{ name: "list_dir", input: {} }] },
      { text: "I am certain everything works." }, // compaction summary (a claim)
      { text: "Done." },
    ],
  });
  let calls = 0;
  // The 7th request overflows the real context once, forcing summarisation.
  const provider: Provider = Object.assign(Object.create(Object.getPrototypeOf(mock)), mock, {
    stream(req: Parameters<Provider["stream"]>[0]) {
      if (++calls === 7) throw new ProviderError("context length exceeded", "mock", 400, false, "context_overflow");
      return mock.stream(req);
    },
  });
  const agent = new Agent({
    provider,
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 10,
    maxTokens: 1000,
    evidenceGate: false,
  });
  await agent.run("change a");
  const first = agent.messages[0]!.content[0] as { text: string };
  expect(first.text).toContain('<evidence source="harness">');
  expect(first.text).toContain("Still failing: `$ bun build nope.ts --outdir out`");
  expect(first.text).toContain("Changed since the last passing check: a.ts");
  expect(first.text.indexOf("<evidence")).toBeLessThan(first.text.indexOf("<notes source=\"model\">"));
});

test("a streak of failed actions starts a fresh episode from task and evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "ah-evidence-"));
  roots.push(root);
  const fail = { toolCalls: [{ name: "bash", input: { command: "bun build missing.ts --outdir out" } }] };
  const events: AgentEvent[] = [];
  const agent = new Agent({
    provider: new MockProvider({ script: [fail, fail, fail, { text: "notes: tried building missing.ts three times" }, { text: "Stopping; missing.ts does not exist." }] }),
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 10,
    maxTokens: 1000,
    resetAfterFailures: 3,
    onEvent: (e) => events.push(e),
  });
  const r = await agent.run("build the project");
  expect(r.outcome).toBe("completed");
  expect(events.some((e) => e.type === "compaction" && e.strategy === "summarize")).toBe(true);
  const head = (agent.messages[0]!.content[0] as { text: string }).text;
  expect(head).toContain("<task>\nbuild the project\n</task>");
  expect(head).toContain("Still failing: `$ bun build missing.ts --outdir out`");
});

test("a reply cut off at the output limit is continued, not accepted as the end", async () => {
  const root = mkdtempSync(join(tmpdir(), "ah-evidence-"));
  roots.push(root);
  const agent = new Agent({
    provider: new MockProvider({ script: [{ text: "let me think about this very carefully and", stopReason: "max_tokens" }, { text: "Answer: 42." }] }),
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 5,
    maxTokens: 100,
  });
  const r = await agent.run("q");
  expect(r.outcome).toBe("completed");
  expect(r.finalText).toBe("Answer: 42.");
});
