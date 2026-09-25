import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/agent/commands.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import { Agent } from "../src/agent/loop.ts";
import { emptyUsage, textOf, type StreamEvent } from "../src/core/types.ts";
import { MockProvider, type MockTurn } from "../src/providers/mock.ts";
import { ProviderError, sseData, type Provider } from "../src/providers/provider.ts";
import { ALL_TOOLS, ToolRegistry } from "../src/tools/index.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// A reviewer that answers from a queue and records what it was shown.
function reviewer(replies: string[]) {
  const prompts: string[] = [];
  const provider = {
    key: "judge",
    kind: "mock",
    capabilities: new MockProvider().capabilities,
    listModels: async () => [],
    async *stream(req: { messages: { role: "user"; content: { type: "text"; text: string }[] }[] }): AsyncGenerator<StreamEvent> {
      prompts.push(textOf(req.messages[0]!));
      const text = replies.shift() ?? "MET";
      yield { type: "done", message: { role: "assistant", content: [{ type: "text", text }] }, stopReason: "end_turn", usage: emptyUsage() };
    },
  } as unknown as Provider;
  return { reviewer: { provider, model: "judge" }, prompts };
}

function setup(script: MockTurn[], replies: string[], testCommand: string | null = null) {
  const root = mkdtempSync(join(tmpdir(), "ah-cmd-"));
  roots.push(root);
  writeFileSync(join(root, "math.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\nexport const twice = (x: number) => add(x, x);\n");
  const events: AgentEvent[] = [];
  const r = reviewer(replies);
  const agent = new Agent({
    provider: new MockProvider({ script }),
    model: "scripted",
    system: "sys",
    tools: new ToolRegistry(ALL_TOOLS),
    toolContext: { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 10,
    maxTokens: 1000,
    onEvent: (e) => events.push(e),
    evidenceGate: false,
    testCommand,
    reviewer: r.reviewer,
  });
  const printed: string[] = [];
  const host = { agent, root, run: (p: string) => agent.run(p), print: (t: string) => void printed.push(t) };
  return { root, agent, events, printed, host, prompts: r.prompts };
}

describe("session commands", () => {
  test("/goal keeps the agent working until the independent judge says MET, then clears", async () => {
    const s = setup(
      [
        { toolCalls: [{ name: "write_file", input: { path: "a.txt", content: "a" } }] },
        { text: "Done, the goal is complete." },
        { toolCalls: [{ name: "write_file", input: { path: "b.txt", content: "b" } }] },
        { text: "Now both files exist." },
      ],
      ["NOT MET\nb.txt is missing", "MET"],
    );
    expect(await runCommand("/goal a.txt and b.txt exist", s.host)).toBe(true);
    expect(existsSync(join(s.root, "b.txt"))).toBe(true);
    const goals = s.events.filter((e) => e.type === "goal").map((e) => (e as { status: string }).status);
    expect(goals).toEqual(["set", "not_met", "met"]);
    expect(s.agent.goal).toBeNull();
    // The judge's reasons reached the model; the judge saw the goal, not the model's claim as fact.
    expect(JSON.stringify(s.agent.messages)).toContain("b.txt is missing");
    expect(s.prompts[0]).toContain("<goal>\na.txt and b.txt exist\n</goal>");
  });

  test("a BLOCKED verdict ends the run and keeps the goal", async () => {
    const s = setup([{ text: "I need the API key to continue." }], ["BLOCKED\nneeds the user's API key"]);
    await runCommand("/goal the deploy script runs", s.host);
    expect(s.events.filter((e) => e.type === "run_end")).toHaveLength(1);
    expect(s.events.some((e) => e.type === "goal" && e.status === "blocked")).toBe(true);
    expect(s.agent.goal).toBe("the deploy script runs");
  });

  test("a failing check overrides a MET verdict", async () => {
    const s = setup([{ text: "All done." }], ["MET"], "exit 3");
    await s.agent.run("do nothing");
    expect(await runCommand("/verify", s.host)).toBe(true);
    expect(s.printed.at(-1)).toStartWith("NOT MET (`exit 3` fails)");
  });

  test("/advisor prints advice and feeds it into the next request", async () => {
    const s = setup([{ text: "first" }, { text: "second" }], ["Check the sign in add before anything else."]);
    await s.agent.run("look at math.ts");
    await runCommand("/advisor what next?", s.host);
    expect(s.printed.at(-1)).toContain("Check the sign");
    expect(s.prompts[0]).toContain("The agent asks: what next?");
    await s.agent.run("continue");
    expect(JSON.stringify(s.agent.messages)).toContain("[advisor] Check the sign");
  });

  test("/loop runs back to back until the check passes", async () => {
    const s = setup([{ text: "one" }, { text: "two" }, { text: "three" }], ["NOT MET\nnot yet", "MET"]);
    await runCommand("/loop 5x tidy up", s.host);
    expect(s.events.filter((e) => e.type === "run_end")).toHaveLength(2);
    expect(s.printed.some((p) => p.startsWith("loop 2: MET"))).toBe(true);
  });

  test("/graph answers from the code graph; unknown lines are not commands", async () => {
    const s = setup([], []);
    await runCommand("/graph add", s.host);
    expect(s.printed.at(-1)).toContain("math.ts:1 function add");
    expect(s.printed.at(-1)).toContain("in const twice");
    await runCommand("/graph", s.host);
    expect(s.printed.at(-1)).toContain("math.ts (5 lines)");
    expect(await runCommand("/unknown thing", s.host)).toBe(false);
    expect(await runCommand("fix the bug", s.host)).toBe(false);
  });
});

test("a stream cut off mid-response is a retryable error", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("data: {}\n\n"));
      c.error(new Error("The socket connection was closed unexpectedly"));
    },
  });
  const seen: string[] = [];
  const err = await (async () => {
    for await (const d of sseData(body)) seen.push(d);
  })().catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect((err as ProviderError).retryable).toBe(true);
});
