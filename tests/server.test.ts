import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  test("UI fonts are served self-hosted and allowed by the CSP", async () => {
    const index = await fetch(`${base}/`);
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/fx.js`)).status).toBe(200);
    const csp = index.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("font-src 'self'");
    for (const f of ["geist", "geist-mono"]) {
      const res = await fetch(`${base}/fonts/${f}.woff2`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("font/woff2");
      const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
      expect(new TextDecoder().decode(head)).toBe("wOF2");
    }
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
    expect(types.slice(0, 2)).toEqual(["user", "session"]);
    expect(types).toContain("tool_end");
    // Live progress while the tool call is written, and where each turn's output went.
    expect(types).toContain("tool_call_progress");
    const mr = events.find((e) => e.type === "model_response") as unknown as { outputChars: { toolArgs: number } };
    expect(mr.outputChars.toolArgs).toBeGreaterThan(0);
    expect(events.at(-1)!.type).toBe("run_end");
    expect(events.at(-1)!.result!.outcome).toBe("completed");
    const runs = (await (await get("/api/telemetry/runs")).json()) as { outcome: string }[];
    expect(runs[0]!.outcome).toBe("completed");
  });
});

describe("chat sessions", () => {
  const get = (p: string) => fetch(`${base}${p}`, { headers: { "x-ah-token": "t0k" } });
  const h = { "x-ah-token": "t0k", "content-type": "application/json" };
  const chat = async (body: Record<string, unknown>) =>
    (await (await fetch(`${base}/api/chat`, { method: "POST", headers: h, body: JSON.stringify(body) })).text())
      .split("\n\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; sessionId?: string; result?: { outcome: string } });

  test("a second message on the same session streams a full run", async () => {
    const mock = srv.env.registry.get("mock") as MockProvider;
    mock.setScript([{ text: "first" }], "scripted");
    const one = await chat({ prompt: "one", model: "mock/scripted" });
    const sessionId = one[1]!.sessionId!;
    mock.setScript([{ text: "second" }], "scripted");
    const two = await chat({ prompt: "two", model: "mock/scripted", sessionId });
    expect(two[1]!.sessionId).toBe(sessionId);
    expect(two.map((e) => e.type)).toContain("run_start");
    expect(two.at(-1)!.result!.outcome).toBe("completed");
    const list = (await (await get("/api/sessions")).json()) as { id: string; runs: number; busy: boolean }[];
    expect(list.find((s) => s.id === sessionId)).toMatchObject({ runs: 2, busy: false });
    // Replay returns both runs, prompts included, with text deltas coalesced.
    const replay = (await (await get(`/api/sessions/${sessionId}`)).text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; text?: string });
    expect(replay.filter((e) => e.type === "user").map((e) => e.text)).toEqual(["one", "two"]);
    expect(replay.filter((e) => e.type === "run_end")).toHaveLength(2);
  });

  test("stop aborts a running task, including a running shell command", async () => {
    const mock = srv.env.registry.get("mock") as MockProvider;
    mock.setScript([{ toolCalls: [{ name: "bash", input: { command: "sleep 5" } }] }, { text: "done" }], "scripted");
    const t0 = performance.now();
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: h, body: JSON.stringify({ prompt: "wait", model: "mock/scripted" }) });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    let stopped = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (!stopped && text.includes('"tool_start"')) {
        stopped = true;
        const sessionId = /"sessionId":"([^"]+)"/.exec(text)![1];
        expect((await fetch(`${base}/api/stop`, { method: "POST", headers: h, body: JSON.stringify({ sessionId }) })).status).toBe(200);
      }
    }
    expect(text).toContain('"outcome":"aborted"');
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  test("diff reports a non-git workspace and refuses paths outside it", async () => {
    expect(await (await get("/api/diff")).json()).toEqual({ git: false, diff: "" });
    expect((await get("/api/diff?files=../../etc/passwd")).status).toBe(500);
  });

  test("@file in a message attaches the file", async () => {
    (srv.env.registry.get("mock") as MockProvider).setScript([{ text: "ok" }], "scripted");
    const ev = (await chat({ prompt: "summarise @a.txt", model: "mock/scripted" })) as { type: string; files?: string[] }[];
    expect(ev.find((e) => e.type === "attachments")?.files).toEqual(["a.txt"]);
  });

  test("sessions survive a server restart and continue the conversation", async () => {
    (srv.env.registry.get("mock") as MockProvider).setScript([{ text: "remembered" }], "scripted");
    const one = await chat({ prompt: "keep this", model: "mock/scripted" });
    const sessionId = one[1]!.sessionId!;
    const again = await startServer({ port: 0, root, env: srv.env, token: "t0k" });
    try {
      const b = `http://127.0.0.1:${again.server.port}`;
      const list = (await (await fetch(`${b}/api/sessions`, { headers: h })).json()) as { id: string; runs: number }[];
      expect(list.find((x) => x.id === sessionId)).toMatchObject({ runs: 1 });
      const replay = await (await fetch(`${b}/api/sessions/${sessionId}`, { headers: h })).text();
      expect(replay).toContain('"text":"keep this"');
      const res = await fetch(`${b}/api/chat`, { method: "POST", headers: h, body: JSON.stringify({ prompt: "and now?", sessionId }) });
      const ev = (await res.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; sessionId?: string; result?: { outcome: string } });
      expect(ev[1]!.sessionId).toBe(sessionId);
      expect(ev.at(-1)!.result!.outcome).toBe("completed");
      const after = (await (await fetch(`${b}/api/sessions`, { headers: h })).json()) as { id: string; runs: number }[];
      expect(after.find((x) => x.id === sessionId)).toMatchObject({ runs: 2 });
      expect((await fetch(`${b}/api/sessions/${sessionId}`, { method: "DELETE", headers: h })).status).toBe(200);
      expect((await fetch(`${b}/api/sessions/../../etc`, { headers: h })).status).toBe(404);
    } finally {
      again.server.stop(true);
    }
  });

  test("provider keys: listed from models.dev, saved 0600, providers rebuilt, removable", async () => {
    srv.env.telemetry.store!.cacheSet("models.dev", JSON.stringify({ acme: { id: "acme", name: "Acme AI", env: ["ACME_TEST_API_KEY"], api: "http://127.0.0.1:9/v1", models: { m1: {} } } }));
    const post = (m: string, b: unknown) => fetch(`${base}/api/credentials`, { method: m, headers: h, body: JSON.stringify(b) });
    const before = (await (await get("/api/providers")).json()) as { id: string; configured: boolean; env: string[] }[];
    expect(before).toEqual([expect.objectContaining({ id: "acme", configured: false, env: ["ACME_TEST_API_KEY"] })]);
    expect((await post("POST", { provider: "nope", key: "k" })).status).toBe(404);
    const r = (await (await post("POST", { provider: "acme", key: "sk-test" })).json()) as { active: boolean };
    expect(r.active).toBe(true);
    expect(statSync(join(home, "credentials.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"))).toEqual({ ACME_TEST_API_KEY: "sk-test" });
    await post("DELETE", { provider: "acme" });
    expect(process.env.ACME_TEST_API_KEY).toBeUndefined();
    expect(srv.env.registry.has("acme")).toBe(false);
  });

  test("stop and steer need a busy session", async () => {
    const post = (p: string, b: unknown) => fetch(`${base}${p}`, { method: "POST", headers: h, body: JSON.stringify(b) });
    expect((await post("/api/stop", { sessionId: "nope" })).status).toBe(404);
    const [first] = (await (await get("/api/sessions")).json()) as { id: string }[];
    expect((await post("/api/steer", { sessionId: first!.id, text: "x" })).status).toBe(409);
  });
});

describe("memory, extensions and approvals API", () => {
  const h = { "x-ah-token": "t0k", "content-type": "application/json" };
  test("memory CRUD", async () => {
    const add = await (await fetch(`${base}/api/memory`, { method: "POST", headers: h, body: JSON.stringify({ text: "use bun test here" }) })).json();
    expect(add.id).toBeGreaterThan(0);
    const found = await (await fetch(`${base}/api/memory?q=bun`, { headers: h })).json();
    expect(found.memories[0].text).toBe("use bun test here");
    expect((await (await fetch(`${base}/api/memory?id=${add.id}`, { method: "DELETE", headers: h })).json()).ok).toBe(true);
  });

  test("extensions status and trust", async () => {
    const x = await (await fetch(`${base}/api/extensions`, { headers: h })).json();
    expect(x.trusted).toBe(false);
    expect(x.mcp).toEqual([]);
    expect(["off", "ask", "auto"]).toContain(x.computer.mode);
    const t = await (await fetch(`${base}/api/extensions`, { method: "POST", headers: h })).json();
    expect(t.trusted).toBe(true);
  });

  test("unknown approval id is 404", async () => {
    expect((await fetch(`${base}/api/approve`, { method: "POST", headers: h, body: JSON.stringify({ id: "nope", allow: true }) })).status).toBe(404);
  });
});

describe("appearance", () => {
  const H = { "x-ah-token": "t0k" };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  test("theme, accent and wallpaper settings are validated and persisted", async () => {
    const post = (b: unknown) => fetch(`${base}/api/appearance`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    expect(await post({ theme: "light", accent: "#22AA66", wallpaper: { opacity: 5, blur: -1 } })).toMatchObject({ theme: "light", accent: "#22aa66", wallpaper: { opacity: 1, blur: 0 } });
    // Invalid values keep the stored ones; CSS injection through accent is impossible.
    expect(await post({ theme: "../x", accent: "red;}body{display:none" })).toMatchObject({ theme: "light", accent: "#22aa66" });
    expect(JSON.parse(readFileSync(join(home, "appearance.json"), "utf8")).theme).toBe("light");
  });

  test("wallpaper upload sniffs magic bytes, needs the token, and round-trips", async () => {
    expect((await fetch(`${base}/api/wallpaper`, { method: "POST", body: PNG })).status).toBe(401);
    const bad = await fetch(`${base}/api/wallpaper`, { method: "POST", headers: H, body: new TextEncoder().encode("<svg onload=alert(1)>") });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/api/wallpaper`, { method: "POST", headers: H, body: PNG });
    expect(await ok.json()).toMatchObject({ hasWallpaper: true, wallpaper: { enabled: true } });
    const img = await fetch(`${base}/api/wallpaper`, { headers: H });
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
    expect(await (await fetch(`${base}/api/wallpaper`, { method: "DELETE", headers: H })).json()).toMatchObject({ hasWallpaper: false });
  });
});

test("generation settings from the page are range-checked", async () => {
  const { parseGeneration } = await import("../src/server/server.ts");
  expect(parseGeneration({ reasoning: "high", temperature: 0.7, topP: 0.9, topK: 20, maxTokens: 8192 })).toEqual({ reasoning: "high", temperature: 0.7, topP: 0.9, topK: 20, maxTokens: 8192 });
  expect(parseGeneration({ reasoning: "ultra", temperature: 9, topK: 1.5 })).toBeUndefined();
  expect(parseGeneration(undefined)).toBeUndefined();
});
