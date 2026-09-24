import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AgentEvent } from "../agent/events.ts";
import { autoSelectModel, buildEnvironment, createSession, loadExtensions, resolveModelContext, type Environment, type Session } from "../app/session.ts";
import { isTrusted, setTrusted } from "../plugins/index.ts";
import { discoverBackend } from "../tools/computer.ts";
import { parseModelRef } from "../config.ts";
import { resolveImageBackend } from "../media/image.ts";
import { compileScene, designScene } from "../media/model3d.ts";
import { sampleHardware } from "../runtimes/hardware.ts";
import { byModel, byTool, recentRuns, runDetail, summary, timeseries } from "../telemetry/metrics.ts";
import { dim, green } from "../cli/render.ts";
import { assetDir } from "../app/paths.ts";
import indexHtmlSrc from "./ui/index.html" with { type: "text" };
import appJs from "./ui/app.js" with { type: "text" };
import fxJs from "./ui/fx.js" with { type: "text" };
import stylesCss from "./ui/styles.css" with { type: "text" };
import geistFont from "./ui/fonts/geist.woff2" with { type: "file" };
import geistMonoFont from "./ui/fonts/geist-mono.woff2" with { type: "file" };

// UI files are imported as text (fonts as embedded files) so they ship inside the compiled binary.
const FONT = "font/woff2";
const IMMUTABLE = "public, max-age=31536000, immutable";
const UI: Record<string, { body: string | Blob; type: string; cache?: string }> = {
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8" },
  "/fx.js": { body: fxJs, type: "text/javascript; charset=utf-8" },
  "/styles.css": { body: stylesCss, type: "text/css; charset=utf-8" },
  "/fonts/geist.woff2": { body: Bun.file(geistFont), type: FONT, cache: IMMUTABLE },
  "/fonts/geist-mono.woff2": { body: Bun.file(geistMonoFont), type: FONT, cache: IMMUTABLE },
};
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'";
const EXAMPLES_DIR = assetDir("examples/bench") ?? "";

interface ChatSession {
  session: Session;
  busy: boolean;
  alwaysAllow: Set<string>;
}

// A tool call waiting for the user in the web UI.
interface PendingApproval {
  sessionId: string;
  tool: string;
  resolve: (allow: boolean) => void;
  timer: Timer;
}
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
type ApprovalEvent = { type: "approval_request"; id: string; tool: string; summary: string; input: string };

// Every API call must carry the per-process token, and the Host header must be local:
// this blocks cross-site requests and DNS rebinding from driving a tool-running agent.
export function authorized(req: Request, token: string, port: number): boolean {
  const host = req.headers.get("host") ?? "";
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false;
  return req.headers.get("x-ah-token") === token;
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

function listBenchRuns(env: Environment) {
  const fromDb = (env.telemetry.store?.db.query("SELECT bench_run_id id, started_at, model, trials, report FROM bench_runs ORDER BY started_at DESC").all() ?? []) as {
    id: string;
    started_at: number;
    model: string;
    trials: number;
    report: string;
  }[];
  const examples: typeof fromDb = [];
  if (EXAMPLES_DIR && existsSync(EXAMPLES_DIR))
    for (const day of readdirSync(EXAMPLES_DIR))
      for (const d of existsSync(join(EXAMPLES_DIR, day)) && statSync(join(EXAMPLES_DIR, day)).isDirectory() ? readdirSync(join(EXAMPLES_DIR, day)) : []) {
        const p = join(EXAMPLES_DIR, day, d, "results.json");
        if (!existsSync(p)) continue;
        const r = JSON.parse(readFileSync(p, "utf8")) as { benchRunId: string; startedAt: string; model: string; trials: number };
        examples.push({ id: r.benchRunId, started_at: Date.parse(r.startedAt), model: r.model, trials: r.trials, report: p });
      }
  const seen = new Set<string>();
  return [...examples, ...fromDb].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export async function startServer(opts: { port: number; root: string; env?: Environment; token?: string }) {
  const env = opts.env ?? (await buildEnvironment({ cwd: opts.root }));
  const token = opts.token ?? randomBytes(24).toString("hex");
  const chats = new Map<string, ChatSession>();
  const approvals = new Map<string, PendingApproval>();
  const db = () => {
    if (!env.telemetry.store) throw new Error("telemetry disabled");
    return env.telemetry.store.db;
  };
  const indexHtml = () => (indexHtmlSrc as unknown as string).replace("__AH_TOKEN__", token);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (!p.startsWith("/api/")) {
        if (p === "/" || p === "/index.html") return new Response(indexHtml(), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-store" } });
        const asset = UI[p];
        if (asset) return new Response(asset.body as unknown as string, { headers: { "content-type": asset.type, "cache-control": asset.cache ?? "no-cache" } });
        return new Response("not found", { status: 404 });
      }
      if (!authorized(req, token, server.port!)) return json({ error: "unauthorized" }, 401);
      const q = url.searchParams;
      const sinceMs = q.get("since") ? Number(q.get("since")) : undefined;
      const filter = { sinceMs, model: q.get("model") ?? undefined, provider: q.get("provider") ?? undefined, benchRunId: q.get("bench") ?? undefined };
      try {
        switch (p) {
          case "/api/doctor":
            return json({
              root: opts.root,
              hardware: await sampleHardware(),
              runtimes: [...env.registry.runtimes.entries()].map(([key, r]) => ({ key, ...r, meta: { nCtx: r.meta.nCtx, hasToolTemplate: r.meta.hasToolTemplate } })),
              providers: env.registry.list().map((x) => ({ key: x.key, kind: x.kind, capabilities: x.capabilities })),
              defaultModel: env.cfg.defaultModel ?? autoSelectModel(env),
              catalogSize: env.catalog.all().length,
              catalogErrors: env.catalog.errors,
            });
          case "/api/hardware":
            return json(await sampleHardware());
          case "/api/models":
            return json(
              env.catalog
                .search({
                  text: q.get("q") || undefined,
                  kind: (q.get("kind") || undefined) as never,
                  toolCall: q.get("tools") ? true : undefined,
                  providers: q.get("local") ? [...env.registry.runtimes.keys()] : undefined,
                  sort: (q.get("sort") as never) ?? "name",
                  limit: Number(q.get("limit") ?? 200),
                })
                .map((m) => ({ ...m, local: env.registry.runtimes.has(m.provider) })),
            );
          case "/api/telemetry/summary":
            return json(summary(db(), filter));
          case "/api/telemetry/runs":
            return json(recentRuns(db(), Number(q.get("limit") ?? 100), filter));
          case "/api/telemetry/models":
            return json(byModel(db(), filter));
          case "/api/telemetry/tools":
            return json(byTool(db(), filter));
          case "/api/telemetry/timeseries":
            return json(timeseries(db(), Number(q.get("bucket") ?? 3_600_000), filter));
          case "/api/bench":
            return json(listBenchRuns(env));
          case "/api/chat":
            return await chat(req);
          case "/api/approve":
            return await approve(req);
          case "/api/memory":
            return await memory(req, q);
          case "/api/extensions":
            return await extensions(req);
          case "/api/image":
            return await image(req);
          case "/api/3d":
            return await model3d(req);
        }
        if (p.startsWith("/api/telemetry/run/")) return json(runDetail(db(), decodeURIComponent(p.slice("/api/telemetry/run/".length))));
        if (p.startsWith("/api/bench/")) {
          const id = decodeURIComponent(p.slice("/api/bench/".length));
          const run = listBenchRuns(env).find((r) => r.id === id);
          if (!run) return json({ error: "not found" }, 404);
          const results = JSON.parse(readFileSync(run.report, "utf8"));
          const summaryPath = run.report.replace(/results\.json$/, "summary.json");
          return json({ results, summary: existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null });
        }
        return json({ error: "not found" }, 404);
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    },
  });

  // Streams agent events as Server-Sent Events. One run at a time per chat session.
  async function chat(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const body = (await req.json()) as { prompt?: string; model?: string; sessionId?: string };
    if (!body.prompt?.trim()) return json({ error: "prompt required" }, 400);
    let id = body.sessionId && chats.has(body.sessionId) ? body.sessionId : undefined;
    let chatSession = id ? chats.get(id)! : undefined;
    if (chatSession?.busy) return json({ error: "session busy" }, 409);
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    const send = (e: AgentEvent | ApprovalEvent | { type: "session"; sessionId: string; model: string; contextWindow: number }) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      } catch {
        /* client went away */
      }
    };
    const ac = new AbortController();
    req.signal.addEventListener("abort", () => ac.abort());
    let listener: ((e: AgentEvent) => void) | null = send;
    // Approvals travel to the page as SSE events and come back through /api/approve.
    let approvalSink: ((e: ApprovalEvent) => void) | null = send;
    const approveFn = (tool: string, input: Record<string, unknown>, summary: string) =>
      new Promise<boolean>((resolve) => {
        const cs = chats.get(id!);
        if (cs?.alwaysAllow.has(tool)) return resolve(true);
        if (!approvalSink) return resolve(false);
        const aid = randomBytes(8).toString("hex");
        const timer = setTimeout(() => {
          approvals.delete(aid);
          resolve(false);
        }, APPROVAL_TIMEOUT_MS);
        approvals.set(aid, { sessionId: id!, tool, resolve, timer });
        approvalSink({ type: "approval_request", id: aid, tool, summary, input: JSON.stringify(input).slice(0, 2000) });
      });
    if (!chatSession) {
      const s = await createSession(env, { model: body.model, root: opts.root, mode: env.cfg.permissionMode, approve: (t, i, sm) => approveFn(t, i, sm), onEvent: (e) => listener?.(e), signal: ac.signal });
      id = s.agent.sessionId;
      chatSession = { session: s, busy: false, alwaysAllow: new Set() };
      chats.set(id, chatSession);
    } else {
      // Later runs reuse the session; route its approvals to this request's stream.
      chatSession.session.agent.setApprover((t, i, sm) => approveFn(t, i, sm));
    }
    const cs = chatSession;
    cs.busy = true;
    send({ type: "session", sessionId: id!, model: cs.session.modelRef, contextWindow: cs.session.context.window });
    void cs.session.agent.run(body.prompt).finally(() => {
      cs.busy = false;
      listener = null;
      approvalSink = null;
      for (const [aid, a] of approvals) {
        if (a.sessionId !== id) continue;
        clearTimeout(a.timer);
        approvals.delete(aid);
        a.resolve(false);
      }
      controller.close();
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }

  async function approve(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const b = (await req.json()) as { id?: string; allow?: boolean; always?: boolean };
    const a = b.id ? approvals.get(b.id) : undefined;
    if (!a) return json({ error: "no such pending approval" }, 404);
    approvals.delete(b.id!);
    clearTimeout(a.timer);
    if (b.allow && b.always) chats.get(a.sessionId)?.alwaysAllow.add(a.tool);
    a.resolve(Boolean(b.allow));
    return json({ ok: true });
  }

  async function memory(req: Request, q: URLSearchParams): Promise<Response> {
    if (!env.memory) return json({ enabled: false, memories: [] });
    const scopes = [opts.root, "global"];
    if (req.method === "DELETE") return json({ ok: env.memory.delete(Number(q.get("id"))) });
    if (req.method === "POST") {
      const b = (await req.json()) as { text?: string; global?: boolean };
      if (!b.text?.trim()) return json({ error: "text required" }, 400);
      return json({ id: env.memory.save({ scope: b.global ? "global" : opts.root, kind: "note", text: b.text }) });
    }
    const text = q.get("q");
    return json({ enabled: true, memories: text ? env.memory.search(text, scopes, 50, 0) : env.memory.list(scopes, 200) });
  }

  async function extensions(req: Request): Promise<Response> {
    if (req.method === "POST") {
      // Trusting from the page is the same as `ah trust`: the workspace's own servers and plugins may load.
      setTrusted(opts.root, true, env.cfg.dataDir);
      (await env.extensions.get(opts.root))?.mcp.close();
      env.extensions.delete(opts.root);
    }
    const x = await loadExtensions(env, opts.root);
    const backend = discoverBackend();
    return json({
      trusted: isTrusted(opts.root, env.cfg.dataDir),
      mcp: x.mcp.status(),
      plugins: x.ext.plugins.map((p) => ({ name: p.manifest.name, description: p.manifest.description, source: p.source })),
      skills: x.ext.skills.map((s) => ({ name: s.name, description: s.description, source: s.source })),
      skipped: x.ext.skipped,
      errors: x.ext.errors,
      computer: { mode: env.cfg.computerUse, backend: backend?.name ?? null },
      permissionMode: env.cfg.permissionMode,
      evidenceGate: env.cfg.evidenceGate,
    });
  }

  async function image(req: Request): Promise<Response> {
    const body = (await req.json()) as { prompt?: string; model?: string; size?: string };
    const backend = resolveImageBackend(env.registry, body.model ?? env.cfg.imageModel);
    if (!backend) return json({ error: "no image backend discovered (start ComfyUI or an sdapi server)" }, 400);
    const [w, h] = (body.size ?? `${env.cfg.image.width}x${env.cfg.image.height}`).split("x").map(Number);
    const t0 = performance.now();
    const imgs = await backend.generate(body.prompt ?? "", { ...env.cfg.image, width: w!, height: h! });
    return json({ backend: backend.ref, ms: performance.now() - t0, images: imgs });
  }

  async function model3d(req: Request): Promise<Response> {
    const body = (await req.json()) as { prompt?: string; model?: string };
    const ref = body.model ?? env.cfg.model3d ?? env.cfg.defaultModel ?? autoSelectModel(env);
    if (!ref) return json({ error: "no chat model available" }, 400);
    const { provider, model } = parseModelRef(ref);
    const t0 = performance.now();
    const { context } = await resolveModelContext(env, ref);
    const scene = await designScene(env.registry.get(provider), model, body.prompt ?? "", { contextWindow: context.window });
    const g = compileScene(scene, "glb");
    return json({ model: ref, ms: performance.now() - t0, glb: g.data.toString("base64"), preview: g.preview, scene, triangles: g.triangles });
  }

  return { server, token, env };
}

export async function cmdServe(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({ args: argv, strict: false, options: { port: { type: "string", short: "p" }, cwd: { type: "string", short: "C" } } });
  const root = resolve((v.cwd as string | undefined) ?? process.cwd());
  const { server } = await startServer({ port: Number(v.port ?? 0), root });
  process.stdout.write(`${green("ah serve")} http://127.0.0.1:${server.port}/  ${dim(`workspace ${root} · bound to loopback · API requires the page token`)}\n`);
  await new Promise(() => {});
  return 0;
}
