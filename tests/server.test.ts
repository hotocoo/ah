import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(types[0]).toBe("session");
    expect(types).toContain("tool_end");
    expect(events.at(-1)!.type).toBe("run_end");
    expect(events.at(-1)!.result!.outcome).toBe("completed");
    const runs = (await (await get("/api/telemetry/runs")).json()) as { outcome: string }[];
    expect(runs[0]!.outcome).toBe("completed");
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

  test("skin, accent and wallpaper settings are validated and persisted", async () => {
    const post = (b: unknown) => fetch(`${base}/api/appearance`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    expect(await post({ skin: "forest", accent: "#22AA66", wallpaper: { opacity: 5, blur: -1 } })).toMatchObject({ skin: "forest", accent: "#22aa66", wallpaper: { opacity: 1, blur: 0 } });
    // Invalid values keep the stored ones; CSS injection through accent is impossible.
    expect(await post({ skin: "../x", accent: "red;}body{display:none" })).toMatchObject({ skin: "forest", accent: "#22aa66" });
    expect(JSON.parse(readFileSync(join(home, "appearance.json"), "utf8")).skin).toBe("forest");
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
