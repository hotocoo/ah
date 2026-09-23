import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnvironment } from "../src/app/session.ts";
import { defaultConfig } from "../src/config.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { authorized, startServer } from "../src/server/server.ts";

let home: string;
let root: string;
let srv: Awaited<ReturnType<typeof startServer>>;
let base: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "ah-srv-home-"));
  root = mkdtempSync(join(tmpdir(), "ah-srv-root-"));
  writeFileSync(join(root, "a.txt"), "hello\n");
  const cfg = { ...defaultConfig(), dataDir: home, runtimes: { endpoints: [], scan: false }, hardwareSampling: { enabled: false, intervalMs: 1000 } };
  const env = await buildEnvironment({ cfg, offline: true, live: false });
  (env.registry.get("mock") as MockProvider).setScript([{ toolCalls: [{ name: "read_file", input: { path: "a.txt" } }] }, { text: "The file says hello." }], "scripted");
  srv = await startServer({ port: 0, root, env, token: "t0k" });
  base = `http://127.0.0.1:${srv.server.port}`;
});
afterAll(() => {
  srv.server.stop(true);
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe("web app security", () => {
  test("authorized requires token and local host/origin", () => {
    const mk = (h: Record<string, string>) => new Request("http://127.0.0.1:1/api/x", { headers: h });
    expect(authorized(mk({ host: "127.0.0.1:1", "x-ah-token": "t" }), "t", 1)).toBe(true);
    expect(authorized(mk({ host: "127.0.0.1:1" }), "t", 1)).toBe(false);
    expect(authorized(mk({ host: "evil.test:1", "x-ah-token": "t" }), "t", 1)).toBe(false);
    expect(authorized(mk({ host: "127.0.0.1:1", origin: "https://evil.test", "x-ah-token": "t" }), "t", 1)).toBe(false);
  });

  test("index embeds the token; API rejects requests without it", async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('content="t0k"');
    expect((await fetch(`${base}/api/doctor`)).status).toBe(401);
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
  });
});

describe("web app API", () => {
  const get = (p: string) => fetch(`${base}${p}`, { headers: { "x-ah-token": "t0k" } });

  test("doctor, models, telemetry, bench endpoints respond", async () => {
    const d = (await (await get("/api/doctor")).json()) as { providers: { key: string }[] };
    expect(d.providers.map((p) => p.key)).toContain("mock");
    expect((await get("/api/telemetry/summary")).status).toBe(200);
    expect((await get("/api/telemetry/tools")).status).toBe(200);
    expect(Array.isArray(await (await get("/api/bench")).json())).toBe(true);
  });

  test("chat streams agent events over SSE and records telemetry", async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "x-ah-token": "t0k", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "what does a.txt say?", model: "mock/scripted" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; result?: { outcome: string } });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session");
    expect(types).toContain("tool_end");
    expect(events.at(-1)!.type).toBe("run_end");
    expect(events.at(-1)!.result!.outcome).toBe("completed");
    const runs = (await (await get("/api/telemetry/runs")).json()) as { outcome: string }[];
    expect(runs[0]!.outcome).toBe("completed");
  });
});
