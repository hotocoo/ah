import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/agent/loop.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { Telemetry, TelemetryStore, OtlpExporter } from "../src/telemetry/index.ts";
import { byModel, byTool, dist, quantile, recentRuns, runDetail, summary, timeseries } from "../src/telemetry/metrics.ts";
import { ToolRegistry } from "../src/tools/index.ts";

async function runOnce(tel: Telemetry) {
  const root = mkdtempSync(join(tmpdir(), "ah-tel-"));
  writeFileSync(join(root, "f.txt"), "hello\n");
  const agent = new Agent({
    provider: new MockProvider({
      script: [
        { toolCalls: [{ name: "read_file", input: { path: "f.txt" } }, { name: "read_file", input: { path: "missing" } }] },
        { text: "done" },
      ],
    }),
    model: "scripted",
    system: "s",
    tools: new ToolRegistry(),
    toolContext: { root, bashTimeoutMs: 5000, todos: [], readFiles: new Set(), media: {} },
    mode: "auto",
    maxTurns: 5,
    maxTokens: 100,
    pricing: { input: 1, output: 2 },
    onEvent: tel.handler,
  });
  const r = await agent.run("go");
  rmSync(root, { recursive: true, force: true });
  return r;
}

describe("telemetry store + metrics", () => {
  test("persists runs, turns, tool calls and events", async () => {
    const store = new TelemetryStore(":memory:");
    const tel = new Telemetry({ store });
    const r = await runOnce(tel);
    const d = runDetail(store.db, r.runId) as { run: Record<string, unknown>; turns: unknown[]; tools: Record<string, unknown>[]; events: { type: string }[] };
    expect(d.run.outcome).toBe("completed");
    expect(d.run.tool_calls).toBe(2);
    expect(d.run.tool_errors).toBe(1);
    expect(d.run.cost_usd as number).toBeGreaterThan(0);
    expect(d.turns).toHaveLength(2);
    expect(d.tools.map((t) => t.is_error).sort()).toEqual([0, 1]);
    expect(d.events.map((e) => e.type)).toContain("run_end");
    expect(d.events.map((e) => e.type)).not.toContain("text_delta");
  });

  test("aggregates", async () => {
    const store = new TelemetryStore(":memory:");
    const tel = new Telemetry({ store });
    await runOnce(tel);
    await runOnce(tel);
    const s = summary(store.db);
    expect(s.totals.runs).toBe(2);
    expect(s.totals.completed).toBe(2);
    expect(s.totals.toolErrorRate).toBeCloseTo(0.5);
    expect(s.turnLatencyMs.n).toBe(4);
    expect((byModel(store.db) as { runs: number }[])[0]!.runs).toBe(2);
    const tools = byTool(store.db);
    expect(tools[0]!.name).toBe("read_file");
    expect(tools[0]!.calls).toBe(4);
    expect(timeseries(store.db, 3_600_000)).toHaveLength(1);
    expect(recentRuns(store.db, 1)).toHaveLength(1);
    expect(summary(store.db, { model: "nope" }).totals.runs).toBe(0);
  });

  test("kv cache honours TTL", () => {
    const store = new TelemetryStore(":memory:");
    store.cacheSet("k", "v");
    expect(store.cacheGet("k", 10_000)).toBe("v");
    expect(store.cacheGet("k", -1)).toBeNull();
  });

  test("a throwing sink does not break the run", async () => {
    const tel = new Telemetry();
    tel.add(() => {
      throw new Error("boom");
    });
    const r = await runOnce(tel);
    expect(r.outcome).toBe("completed");
  });
});

describe("otlp", () => {
  test("builds a span tree with GenAI attributes", async () => {
    const otlp = new OtlpExporter();
    await runOnce(new Telemetry({ otlp }));
    await otlp.flush();
    const spans = otlp.exported;
    const root = spans.find((s) => s.name === "invoke_agent ah")!;
    expect(root.parentSpanId).toBeUndefined();
    const chats = spans.filter((s) => s.name.startsWith("chat "));
    const tools = spans.filter((s) => s.name.startsWith("execute_tool"));
    expect(chats).toHaveLength(2);
    expect(tools).toHaveLength(2);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(chats.every((s) => s.parentSpanId === root.spanId)).toBe(true);
    expect(chats[0]!.attributes.find((a) => a.key === "gen_ai.usage.input_tokens")).toBeDefined();
    expect(tools.filter((s) => s.status.code === 2)).toHaveLength(1);
  });

  test("posts OTLP JSON to the collector", async () => {
    const bodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        bodies.push({ path: new URL(req.url).pathname, body: await req.json() });
        return new Response("{}");
      },
    });
    try {
      const otlp = new OtlpExporter(`http://localhost:${server.port}`);
      await runOnce(new Telemetry({ otlp }));
      await otlp.flush();
      expect(bodies).toHaveLength(1);
      const b = bodies[0] as { path: string; body: { resourceSpans: { scopeSpans: { spans: unknown[] }[] }[] } };
      expect(b.path).toBe("/v1/traces");
      expect(b.body.resourceSpans[0]!.scopeSpans[0]!.spans.length).toBe(5);
    } finally {
      server.stop(true);
    }
  });
});

describe("stats helpers", () => {
  test("quantile + dist", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
    const d = dist([3, null, 1, 2, Number.NaN]);
    expect(d).toMatchObject({ n: 3, mean: 2, p50: 2, max: 3 });
  });
});
