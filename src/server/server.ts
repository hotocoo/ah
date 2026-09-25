import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AgentEvent } from "../agent/events.ts";
import { autoSelectModel, buildEnvironment, createSession, loadExtensions, modelControls, refreshProviders, resolveModelContext, type Environment, type GenerationOverrides, type Session } from "../app/session.ts";
import { isTrusted, setTrusted } from "../plugins/index.ts";
import type { PermissionMode } from "../tools/index.ts";
import { confine } from "../tools/types.ts";
import { adapterForNpm } from "../providers/registry.ts";
import { saveCredential } from "../app/credentials.ts";
import { installSkill, searchMcp, searchSkills } from "../plugins/market.ts";
import type { McpServerConfig } from "../mcp/client.ts";
import { walkFiles } from "../tools/search.ts";
import { discoverBackend } from "../tools/computer.ts";
import { checkSetting, defaultConfig, getPath, parseModelRef, SETTINGS } from "../config.ts";
import { resolveImageBackend } from "../media/image.ts";
import { compileScene, designScene } from "../media/model3d.ts";
import { sampleHardware } from "../runtimes/hardware.ts";
import { byModel, byTool, recentRuns, runDetail, summary, timeseries } from "../telemetry/metrics.ts";
import { dim, green } from "../cli/render.ts";
import { assetDir } from "../app/paths.ts";
import { AppearanceStore, MAX_WALLPAPER_BYTES } from "./appearance.ts";
import { fetchDailyPhoto } from "./daily-photo.ts";
import { SessionStore } from "./session-store.ts";
import indexHtmlSrc from "./ui/index.html" with { type: "text" };
import appJs from "./ui/app.js" with { type: "text" };
import fxJs from "./ui/fx.js" with { type: "text" };
import utilJs from "./ui/util.js" with { type: "text" };
import consoleJs from "./ui/console.js" with { type: "text" };
import stylesCss from "./ui/styles.css" with { type: "text" };
import geistFont from "./ui/fonts/geist.woff2" with { type: "file" };
import geistMonoFont from "./ui/fonts/geist-mono.woff2" with { type: "file" };

// UI files are imported as text (fonts as embedded files) so they ship inside the compiled binary.
const FONT = "font/woff2";
const IMMUTABLE = "public, max-age=31536000, immutable";
const UI: Record<string, { body: string | Blob; type: string; cache?: string }> = {
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8" },
  "/fx.js": { body: fxJs, type: "text/javascript; charset=utf-8" },
  "/util.js": { body: utilJs, type: "text/javascript; charset=utf-8" },
  "/console.js": { body: consoleJs, type: "text/javascript; charset=utf-8" },
  "/styles.css": { body: stylesCss, type: "text/css; charset=utf-8" },
  "/fonts/geist.woff2": { body: Bun.file(geistFont), type: FONT, cache: IMMUTABLE },
  "/fonts/geist-mono.woff2": { body: Bun.file(geistMonoFont), type: FONT, cache: IMMUTABLE },
};
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'";
const EXAMPLES_DIR = assetDir("examples/bench") ?? "";

const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "read-only"];
interface ChatSession {
  id: string;
  session: Session;
  busy: boolean;
  alwaysAllow: Set<string>;
  // Pages watching the session live, every event so far (for replay), and the run's stop switch.
  subs: Set<Subscriber>;
  log: StreamEvent[];
  ac: AbortController | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  runs: number;
  mode: PermissionMode;
  lastOutcome: string | null;
}
type SessionEvent = { type: "session"; sessionId: string; model: string; contextWindow: number; mode: PermissionMode };
type StreamEvent = AgentEvent | ApprovalEvent | SessionEvent | { type: "user"; text: string; t: number } | { type: "approval_result"; id: string; allow: boolean; reason?: string };
interface Subscriber {
  write: (e: StreamEvent) => void;
  close: () => void;
}
const MAX_SESSION_EVENTS = 20_000;

// A tool call waiting for the user in the web UI.
interface PendingApproval {
  sessionId: string;
  tool: string;
  resolve: (allow: boolean) => void;
  timer: Timer;
}
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
type ApprovalEvent = { type: "approval_request"; id: string; tool: string; summary: string; input: string };

// Validated per-session generation settings from the page; anything out of range is dropped.
const EFFORTS = ["off", "low", "medium", "high", "max"] as const;
// Chat-template switches: plain identifiers with scalar values (the template decides what they mean).
function kwargsIn(v: unknown): Record<string, string | number | boolean> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => /^[A-Za-z]\w{0,63}$/.test(k) && ["string", "number", "boolean"].includes(typeof x) && String(x).length <= 200).slice(0, 24)) as Record<string, string | number | boolean>;
  return Object.keys(out).length ? out : undefined;
}
export function parseGeneration(g: Record<string, unknown> | undefined): GenerationOverrides | undefined {
  if (!g || typeof g !== "object") return undefined;
  const numIn = (v: unknown, lo: number, hi: number, int = false) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)) ? v : undefined);
  const out: GenerationOverrides = {
    reasoning: EFFORTS.includes(g.reasoning as never) ? (g.reasoning as GenerationOverrides["reasoning"]) : undefined,
    temperature: numIn(g.temperature, 0, 2),
    topP: numIn(g.topP, 0, 1),
    topK: numIn(g.topK, 1, 10_000, true),
    maxTokens: numIn(g.maxTokens, 256, 2_000_000, true),
    templateKwargs: kwargsIn(g.templateKwargs),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

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
  const looks = new AppearanceStore(env.cfg.dataDir);
  const store = new SessionStore(join(env.cfg.dataDir, "sessions"));
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
              permissionMode: env.cfg.permissionMode,
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
                  providers: q.get("local") ? [...env.registry.runtimes.keys()] : q.get("available") ? usableProviders() : undefined,
                  sort: (q.get("sort") as never) ?? "name",
                  limit: q.get("limit") ? Number(q.get("limit")) : undefined,
                })
                .map((m) => ({ ...m, local: env.registry.runtimes.has(m.provider), available: env.registry.has(m.provider) })),
            );
          case "/api/models/refresh":
            if (req.method !== "POST") return json({ error: "POST required" }, 405);
            await refreshProviders(env, { refresh: true });
            return json({ models: env.catalog.all().length, providers: usableProviders(), errors: env.catalog.errors });
          case "/api/model-controls":
            return json(await modelControls(env, q.get("model") || env.cfg.defaultModel || autoSelectModel(env) || "mock/echo"));
          case "/api/providers":
            return json(providerList());
          case "/api/credentials":
            return await credentials(req);
          case "/api/config":
            return await configRoute(req);
          case "/api/market/mcp":
            return await marketMcp(req, q);
          case "/api/market/skills":
            return await marketSkills(req, q);
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
          case "/api/stop":
          return await control(req, "stop");
        case "/api/steer":
          return await control(req, "steer");
        case "/api/sessions":
          return sessions();
        case "/api/diff":
          return workspaceDiff(q);
        case "/api/files":
          return json(findFiles(opts.root, q.get("q") ?? ""));
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
          case "/api/presets":
            return json(Object.entries(env.cfg.presets).map(([name, p]) => ({ name, description: p.description ?? "", model: p.model ?? null })));
          case "/api/appearance":
            return json(req.method === "POST" ? looks.set(await req.json()) : looks.get());
          case "/api/wallpaper/daily": {
            if (req.method !== "POST") return json({ error: "POST required" }, 405);
            if (env.offline) return json({ error: "offline" }, 503);
            const photo = await fetchDailyPhoto();
            looks.saveWallpaper(photo.body, photo.credit);
            return json(looks.get());
          }
          case "/api/wallpaper":
            return await wallpaper(req);
        }
        if (p.startsWith("/api/sessions/")) return sessionRoute(req, decodeURIComponent(p.slice("/api/sessions/".length)));
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

  // Runs belong to the session, not to the HTTP request: closing the tab does not stop the
  // agent. Every event is kept in the session's log (text deltas coalesced), so a page can
  // replay a session and re-attach to a run in progress. Stop is explicit (/api/stop).
  const sseHeaders = { "content-type": "text/event-stream", "cache-control": "no-store" };
  function subscribe(cs: ChatSession, req: Request, replay: boolean): Response {
    const encoder = new TextEncoder();
    let sub: Subscriber | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (e: StreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            /* client went away */
          }
        };
        const close = () => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        if (replay) for (const e of cs.log) write(e);
        if (!cs.busy) return close();
        sub = { write, close };
        cs.subs.add(sub);
        req.signal.addEventListener("abort", () => sub && cs.subs.delete(sub));
      },
      cancel() {
        if (sub) cs.subs.delete(sub);
      },
    });
    return new Response(stream, { headers: sseHeaders });
  }

  function publish(cs: ChatSession, e: StreamEvent) {
    // Progress ticks matter only live; replay has the finished tool call.
    if (e.type === "tool_call_progress") {
      for (const s of cs.subs) s.write(e);
      return;
    }
    // Screenshots are large and only shown live: keep a stub in the log (and on disk).
    if (e.type === "tool_image") {
      for (const s of cs.subs) s.write(e);
      if (cs.log.length < MAX_SESSION_EVENTS) cs.log.push({ ...e, data: "" });
      return;
    }
    const last = cs.log.at(-1);
    if ((e.type === "text_delta" || e.type === "thinking_delta") && last?.type === e.type && last.turn === e.turn) cs.log[cs.log.length - 1] = { ...last, text: last.text + e.text };
    else if (cs.log.length < MAX_SESSION_EVENTS) cs.log.push(e);
    for (const s of cs.subs) s.write(e);
  }

  async function chat(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const body = (await req.json()) as { prompt?: string; model?: string; preset?: string; sessionId?: string; mode?: string; generation?: Record<string, unknown> };
    const generation = parseGeneration(body.generation);
    const prompt = body.prompt?.trim();
    if (!prompt) return json({ error: "prompt required" }, 400);
    const mode = PERMISSION_MODES.includes(body.mode as PermissionMode) ? (body.mode as PermissionMode) : undefined;
    let chatSession = body.sessionId ? chats.get(body.sessionId) : undefined;
    if (chatSession?.busy) return json({ error: "session busy" }, 409);
    if (!chatSession) {
      // A session from an earlier server process continues where it stopped: same model,
      // its transcript for replay, and the agent's messages as the conversation so far.
      const stored = body.sessionId ? store.load(body.sessionId) : null;
      const saved = stored?.root === opts.root ? stored : null;
      const m = mode ?? (saved?.mode as PermissionMode | undefined) ?? env.cfg.permissionMode;
      let cs!: ChatSession;
      const s = await createSession(env, { model: saved?.model ?? body.model, preset: saved ? undefined : body.preset || undefined, generation, root: opts.root, mode: m, approve: () => Promise.resolve(false), onEvent: (e) => publish(cs, e) });
      if (saved) s.agent.messages.push(...(saved.messages as typeof s.agent.messages));
      cs = { id: saved?.id ?? s.agent.sessionId, session: s, busy: false, alwaysAllow: new Set(), subs: new Set(), log: (saved?.log as StreamEvent[]) ?? [], ac: null, title: saved?.title ?? prompt.slice(0, 80), createdAt: saved?.createdAt ?? Date.now(), updatedAt: Date.now(), runs: saved?.runs ?? 0, mode: m, lastOutcome: saved?.lastOutcome ?? null };
      chats.set(cs.id, cs);
      chatSession = cs;
    } else if (mode && mode !== chatSession.mode) {
      chatSession.session.agent.setMode(mode);
      chatSession.mode = mode;
    }
    const cs = chatSession;
    const id = cs.id;
    const agent = cs.session.agent;
    if (generation) agent.setGeneration(generation);
    // Approvals travel to the page as SSE events and come back through /api/approve.
    agent.setApprover(
      (tool, input, summary) =>
        new Promise<boolean>((resolve) => {
          if (cs.alwaysAllow.has(tool)) return resolve(true);
          const aid = randomBytes(8).toString("hex");
          const timer = setTimeout(() => {
            approvals.delete(aid);
            publish(cs, { type: "approval_result", id: aid, allow: false, reason: "timed out" });
            resolve(false);
          }, APPROVAL_TIMEOUT_MS);
          approvals.set(aid, { sessionId: id, tool, resolve: (allow) => (publish(cs, { type: "approval_result", id: aid, allow }), resolve(allow)), timer });
          publish(cs, { type: "approval_request", id: aid, tool, summary, input: JSON.stringify(input).slice(0, 4000) });
        }),
    );
    const ac = new AbortController();
    agent.setSignal(ac.signal);
    cs.ac = ac;
    cs.busy = true;
    cs.runs++;
    cs.updatedAt = Date.now();
    const res = subscribe(cs, req, false);
    publish(cs, { type: "user", text: prompt, t: Date.now() });
    publish(cs, { type: "session", sessionId: id, model: cs.session.modelRef, contextWindow: cs.session.context.window, mode: cs.mode });
    void agent
      .run(prompt)
      .then((r) => void (cs.lastOutcome = r.outcome))
      .catch((err) => publish(cs, { type: "error", runId: "", turn: 0, message: (err as Error).message, t: Date.now() }))
      .finally(() => {
        cs.busy = false;
        cs.ac = null;
        cs.updatedAt = Date.now();
        for (const [aid, a] of approvals) {
          if (a.sessionId !== id) continue;
          clearTimeout(a.timer);
          approvals.delete(aid);
          a.resolve(false);
        }
        for (const s of cs.subs) s.close();
        cs.subs.clear();
        try {
          store.save({ id, root: opts.root, title: cs.title, model: cs.session.modelRef, mode: cs.mode, createdAt: cs.createdAt, updatedAt: cs.updatedAt, runs: cs.runs, lastOutcome: cs.lastOutcome, log: cs.log, messages: agent.messages });
        } catch (err) {
          process.stderr.write(`[ah] could not save session ${id}: ${(err as Error).message}\n`);
        }
      });
    return res;
  }

  // Stop the running task, or add a message to it (steering) without waiting for it to end.
  async function control(req: Request, action: "stop" | "steer"): Promise<Response> {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const b = (await req.json()) as { sessionId?: string; text?: string };
    const cs = b.sessionId ? chats.get(b.sessionId) : undefined;
    if (!cs) return json({ error: "no such session" }, 404);
    if (!cs.busy) return json({ error: "session is idle" }, 409);
    if (action === "stop") cs.ac?.abort();
    else {
      const text = b.text?.trim();
      if (!text) return json({ error: "text required" }, 400);
      cs.session.agent.steer(text.slice(0, 20_000));
    }
    return json({ ok: true });
  }

  function sessions(): Response {
    const live = [...chats.values()].map((c) => ({ id: c.id, title: c.title, model: c.session.modelRef, busy: c.busy, runs: c.runs, mode: c.mode, createdAt: c.createdAt, updatedAt: c.updatedAt, lastOutcome: c.lastOutcome }));
    const saved = store
      .list(opts.root)
      .filter((m) => !chats.has(m.id))
      .map((m) => ({ ...m, busy: false }));
    return json([...live, ...saved].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  // Chat-capable providers ah can call right now (runtimes and keyed cloud providers).
  const usableProviders = () => env.registry.list().map((p) => p.key).filter((k) => k !== "mock");

  // Every provider models.dev describes that ah has an adapter for, with the key variable it
  // reads and whether that key is set. Straight from the catalog lookup, nothing listed by hand.
  function providerList() {
    const raw = env.telemetry.store?.cacheGet("models.dev", Number.POSITIVE_INFINITY);
    const md = raw ? (JSON.parse(raw) as Record<string, { id: string; name?: string; env?: string[]; npm?: string; api?: string; doc?: string; models?: Record<string, unknown> }>) : {};
    return Object.values(md)
      .filter((p) => adapterForNpm(p.npm, p.api) && (p.env ?? []).length)
      .map((p) => ({ id: p.id, name: p.name ?? p.id, env: p.env ?? [], doc: p.doc ?? null, models: Object.keys(p.models ?? {}).length, configured: (p.env ?? []).some((v) => Boolean(process.env[v])), active: env.registry.has(p.id) }))
      .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
  }

  // Save or remove a provider API key, then rebuild providers so its models are usable at once.
  async function credentials(req: Request): Promise<Response> {
    if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "POST or DELETE required" }, 405);
    const b = (await req.json()) as { provider?: string; key?: string };
    const p = providerList().find((x) => x.id === b.provider);
    if (!p) return json({ error: `unknown provider ${b.provider}` }, 404);
    const key = req.method === "POST" ? b.key?.trim() : null;
    if (req.method === "POST" && !key) return json({ error: "key required" }, 400);
    saveCredential(env.cfg.dataDir, p.env[0]!, key ?? null);
    await refreshProviders(env);
    const listed = env.catalog.all().filter((m) => m.provider === p.id).length;
    return json({ ok: true, provider: p.id, active: env.registry.has(p.id), models: listed, errors: env.catalog.errors.filter((e) => e.includes(p.id)) });
  }

  // Settings: the effective value of every editable key, what ~/.ah/config.json sets, and the
  // default. Writes go to that user file (validated) and apply to this server at once.
  async function configRoute(req: Request): Promise<Response> {
    const file = join(env.cfg.dataDir, "config.json");
    const read = (): Record<string, unknown> => {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const setPath = (obj: Record<string, unknown>, key: string, value: unknown) => {
      const parts = key.split(".");
      let o = obj;
      for (const k of parts.slice(0, -1)) o = (o[k] && typeof o[k] === "object" ? o[k] : (o[k] = {})) as Record<string, unknown>;
      if (value === null || value === undefined) delete o[parts.at(-1)!];
      else o[parts.at(-1)!] = value;
    };
    if (req.method === "POST") {
      const b = (await req.json()) as { key?: string; value?: unknown };
      const value = checkSetting(String(b.key), b.value ?? null);
      const user = read();
      setPath(user, b.key!, value);
      writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`);
      setPath(env.cfg as unknown as Record<string, unknown>, b.key!, value ?? getPath(defaultConfig(), b.key!));
    } else if (req.method === "PUT") {
      const b = (await req.json()) as { text?: string };
      let parsed: unknown;
      try {
        parsed = JSON.parse(b.text ?? "");
      } catch (err) {
        return json({ error: `not valid JSON: ${(err as Error).message}` }, 400);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "config must be a JSON object" }, 400);
      writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
      for (const spec of SETTINGS) setPath(env.cfg as unknown as Record<string, unknown>, spec.key, getPath(parsed, spec.key) ?? getPath(defaultConfig(), spec.key));
    }
    const user = read();
    return json({
      path: file,
      raw: JSON.stringify(user, null, 2),
      fields: SETTINGS.map((spec) => ({ ...spec, value: getPath(env.cfg, spec.key) ?? null, user: getPath(user, spec.key) ?? null, default: getPath(defaultConfig(), spec.key) ?? null })),
    });
  }

  // Marketplace. Listings come live from the MCP registry and skills.sh; installs write the
  // same files a user would (config.json mcpServers, ~/.ah/skills/<name>), then extensions reload.
  const userConfigFile = () => join(env.cfg.dataDir, "config.json");
  const readUser = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(userConfigFile(), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const reloadExtensions = async () => {
    (await env.extensions.get(opts.root))?.mcp.close();
    env.extensions.delete(opts.root);
  };
  const serverKey = (name: string) => name.split("/").at(-1)!.replace(/[^\w-]/g, "-").slice(0, 60);

  async function marketMcp(req: Request, q: URLSearchParams): Promise<Response> {
    const user = readUser();
    const servers = (user.mcpServers ?? {}) as Record<string, McpServerConfig>;
    if (req.method === "GET") {
      const r = await searchMcp(q.get("q") ?? "", q.get("cursor") ?? undefined);
      return json({ next: r.next, servers: r.servers.map((x) => ({ ...x, key: serverKey(x.name), installed: serverKey(x.name) in servers })) });
    }
    const b = (await req.json()) as { name?: string; key?: string; env?: Record<string, string> };
    if (req.method === "DELETE") {
      delete servers[String(b.key)];
    } else {
      // Rebuild the entry from the registry itself; the page only supplies variable values.
      const hit = (await searchMcp(String(b.name))).servers.find((x) => x.name === b.name);
      if (!hit?.install) return json({ error: `${b.name} has no installable package or remote in the registry` }, 400);
      const values = Object.fromEntries(Object.entries(b.env ?? {}).filter(([k, v]) => hit.install!.env.some((e) => e.name === k) && typeof v === "string" && v));
      const missing = hit.install.env.filter((e) => e.required && !values[e.name]).map((e) => e.name);
      if (missing.length) return json({ error: `required: ${missing.join(", ")}` }, 400);
      servers[serverKey(hit.name)] = { ...hit.install.config, ...(Object.keys(values).length ? (hit.install.kind === "remote" ? { headers: values } : { env: values }) : {}) };
    }
    user.mcpServers = servers;
    writeFileSync(userConfigFile(), `${JSON.stringify(user, null, 2)}\n`);
    await reloadExtensions();
    return json({ ok: true, installed: Object.keys(servers) });
  }

  async function marketSkills(req: Request, q: URLSearchParams): Promise<Response> {
    const dir = join(env.cfg.dataDir, "skills");
    if (req.method === "GET") {
      const skills = await searchSkills(q.get("q") ?? "");
      return json(skills.map((s) => ({ ...s, installed: existsSync(join(dir, s.skillId, "SKILL.md")) })));
    }
    const b = (await req.json()) as { source?: string; skillId?: string };
    if (req.method === "DELETE") {
      if (!/^[\w.-]+$/.test(String(b.skillId))) return json({ error: "invalid skill" }, 400);
      rmSync(join(dir, String(b.skillId)), { recursive: true, force: true });
    } else {
      const r = await installSkill(String(b.source), String(b.skillId), dir);
      await reloadExtensions();
      return json({ ok: true, ...r });
    }
    await reloadExtensions();
    return json({ ok: true });
  }

  // Uncommitted changes in the workspace (optionally only some files), for review in the console.
  function workspaceDiff(q: URLSearchParams): Response {
    const files = (q.get("files") ?? "").split(",").filter(Boolean).map((f) => relative(opts.root, confine(opts.root, f)) || ".");
    const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: opts.root, stdout: "pipe", stderr: "pipe" });
    if (git(["rev-parse", "--is-inside-work-tree"]).exitCode !== 0) return json({ git: false, diff: "" });
    const hasHead = git(["rev-parse", "--verify", "-q", "HEAD"]).exitCode === 0;
    const tracked = git(["diff", "--no-color", "--no-ext-diff", ...(hasHead ? ["HEAD"] : []), "--", ...files]).stdout.toString();
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...files]).stdout.toString().split("\n").filter(Boolean);
    const added = untracked
      .slice(0, 50)
      .map((f) => git(["diff", "--no-color", "--no-index", "--", "/dev/null", f]).stdout.toString())
      .join("");
    return json({ git: true, diff: (tracked + added).slice(0, 400_000) });
  }

  // GET replays a session's events (and follows a live run); DELETE forgets an idle session.
  function sessionRoute(req: Request, id: string): Response {
    const cs = chats.get(id);
    if (req.method === "DELETE") {
      if (cs?.busy) return json({ error: "session is busy" }, 409);
      chats.delete(id);
      store.remove(id);
      return json({ ok: true });
    }
    if (cs) return subscribe(cs, req, true);
    const saved = store.load(id);
    if (!saved || saved.root !== opts.root) return json({ error: "no such session" }, 404);
    const body = saved.log.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    return new Response(body, { headers: sseHeaders });
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

  async function wallpaper(req: Request): Promise<Response> {
    if (req.method === "DELETE") {
      looks.removeWallpaper();
      return json(looks.get());
    }
    if (req.method === "POST") {
      // Reject by declared size before buffering; the buffered size is checked again in saveWallpaper.
      if (Number(req.headers.get("content-length") ?? 0) > MAX_WALLPAPER_BYTES) return json({ error: "wallpaper too large" }, 413);
      try {
        looks.saveWallpaper(new Uint8Array(await req.arrayBuffer()));
      } catch (err) {
        return json({ error: (err as Error).message }, 400);
      }
      return json(looks.get());
    }
    const w = looks.wallpaper();
    if (!w) return json({ error: "no wallpaper" }, 404);
    return new Response(w.body, { headers: { "content-type": w.type, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
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

// Workspace files for @-mention completion: basename prefix, then basename, then path
// substring, then the query's characters in order within the file name. Bounded walk.
const MAX_WALK = 20_000;
export function findFiles(root: string, query: string, limit = 20): string[] {
  const q = query.toLowerCase();
  const scored: [number, string][] = [];
  let n = 0;
  for (const abs of walkFiles(root)) {
    if (++n > MAX_WALK) break;
    const path = relative(root, abs);
    const p = path.toLowerCase();
    const base = p.slice(p.lastIndexOf("/") + 1);
    let score = base.startsWith(q) ? 0 : base.includes(q) ? 1 : p.includes(q) ? 2 : -1;
    if (score < 0) {
      let i = 0;
      for (const c of base) if (c === q[i]) i++;
      if (i < q.length) continue;
      score = 3;
    }
    scored.push([score * 1000 + path.length, path]);
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, p]) => p);
}

// A stable default port so the URL can be bookmarked; falls back to any free port if taken.
export const DEFAULT_PORT = 4747;

export async function cmdServe(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({ args: argv, strict: false, options: { port: { type: "string", short: "p" }, cwd: { type: "string", short: "C" }, open: { type: "boolean" }, "no-open": { type: "boolean" } } });
  const root = resolve((v.cwd as string | undefined) ?? process.cwd());
  const wanted = v.port === undefined ? DEFAULT_PORT : Number(v.port);
  const env = await buildEnvironment({ cwd: root });
  let started: Awaited<ReturnType<typeof startServer>>;
  try {
    started = await startServer({ port: wanted, root, env });
  } catch (err) {
    if (v.port !== undefined || !/EADDRINUSE|in use/i.test(String((err as Error).message ?? err))) throw err;
    started = await startServer({ port: 0, root, env });
  }
  const url = `http://127.0.0.1:${started.server.port}/`;
  process.stdout.write(`\n  ${green("ah web app")}  ${url}\n  ${dim(`workspace ${root}`)}\n  ${dim("loopback only · Ctrl-C to stop · ah serve --no-open to skip the browser")}\n\n`);
  // Open the browser for interactive launches (or when asked), like `vite --open`.
  const shouldOpen = v.open === true || (v["no-open"] !== true && process.stdout.isTTY === true && !process.env.CI);
  if (shouldOpen) openBrowser(url);
  await new Promise(() => {});
  return 0;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    /* no opener available: the URL is printed above */
  }
}
