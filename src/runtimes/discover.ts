// Discovers model runtimes on this machine without any hardcoded ports or vendor list:
// candidate endpoints come from config, environment variables and the set of
// locally listening TCP ports; each candidate is identified by probing API signatures.

export type RuntimeKind = "ollama" | "llamacpp" | "lmstudio" | "comfyui" | "sdapi" | "openai-compatible";

export interface RuntimeInfo {
  kind: RuntimeKind;
  baseURL: string; // origin, e.g. http://127.0.0.1:11434
  source: "config" | "env" | "scan";
  version?: string;
  models: string[];
  // Kind-specific facts gathered during fingerprinting (e.g. llama.cpp n_ctx).
  meta: Record<string, unknown>;
}

type Probe = (origin: string, timeoutMs: number) => Promise<Omit<RuntimeInfo, "baseURL" | "source"> | null>;

async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      const text = await res.text();
      return text.trim().startsWith("{") || text.trim().startsWith("[") ? JSON.parse(text) : null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// Order matters: specific signatures first, generic OpenAI-compatible last.
export const PROBES: { kind: RuntimeKind; probe: Probe }[] = [
  {
    kind: "ollama",
    probe: async (o, t) => {
      const v = await getJson(`${o}/api/version`, t);
      if (!isObj(v) || typeof v.version !== "string") return null;
      const tags = await getJson(`${o}/api/tags`, t);
      const models = isObj(tags) && Array.isArray(tags.models) ? tags.models.map((m) => String((m as { name: string }).name)) : [];
      return { kind: "ollama", version: v.version, models, meta: {} };
    },
  },
  {
    kind: "llamacpp",
    probe: async (o, t) => {
      const p = await getJson(`${o}/props`, t);
      if (!isObj(p) || !isObj(p.default_generation_settings)) return null;
      const list = await getJson(`${o}/v1/models`, t);
      const data = isObj(list) && Array.isArray(list.data) ? (list.data as { id: string }[]) : [];
      const settings = p.default_generation_settings as Record<string, unknown>;
      return {
        kind: "llamacpp",
        version: typeof p.build_info === "string" ? p.build_info : undefined,
        models: data.map((d) => d.id),
        meta: {
          nCtx: settings.n_ctx ?? (isObj(settings.params) ? settings.params.n_ctx : undefined),
          totalSlots: p.total_slots,
          modalities: p.modalities,
          chatTemplateCaps: p.chat_template_caps,
          hasToolTemplate: Boolean(p.chat_template_tool_use) || /tool/.test(String(p.chat_template ?? "")),
          modelPath: p.model_path,
        },
      };
    },
  },
  {
    kind: "comfyui",
    probe: async (o, t) => {
      const s = await getJson(`${o}/system_stats`, t);
      if (!isObj(s) || !isObj(s.system) || !Array.isArray(s.devices)) return null;
      const ckpts = await getJson(`${o}/models/checkpoints`, t);
      return {
        kind: "comfyui",
        version: String((s.system as Record<string, unknown>).comfyui_version ?? ""),
        models: Array.isArray(ckpts) ? ckpts.map(String) : [],
        meta: { devices: s.devices },
      };
    },
  },
  {
    kind: "sdapi",
    probe: async (o, t) => {
      const m = await getJson(`${o}/sdapi/v1/sd-models`, t);
      if (!Array.isArray(m)) return null;
      return { kind: "sdapi", models: m.map((x) => String((x as { title?: string; model_name?: string }).model_name ?? (x as { title?: string }).title)), meta: {} };
    },
  },
  {
    kind: "lmstudio",
    probe: async (o, t) => {
      const m = await getJson(`${o}/api/v0/models`, t);
      if (!isObj(m) || !Array.isArray(m.data) || !m.data.every((d) => isObj(d) && "state" in d)) return null;
      const data = m.data as { id: string; state: string; type?: string; max_context_length?: number; loaded_context_length?: number }[];
      return {
        kind: "lmstudio",
        models: data.map((d) => d.id),
        meta: { models: data },
      };
    },
  },
  {
    kind: "openai-compatible",
    probe: async (o, t) => {
      const m = await getJson(`${o}/v1/models`, t);
      if (!isObj(m) || !Array.isArray(m.data)) return null;
      return { kind: "openai-compatible", models: (m.data as { id: string }[]).map((d) => d.id), meta: {} };
    },
  },
];

// Runs all probes concurrently and returns the highest-priority match.
export async function fingerprint(origin: string, timeoutMs = 800): Promise<Omit<RuntimeInfo, "source"> | null> {
  const clean = origin.replace(/\/+$/, "").replace(/\/v1$/, "");
  // Cheap liveness check first: skip ports that do not speak HTTP at all.
  try {
    await fetch(clean, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
  } catch {
    return null;
  }
  const results = await Promise.all(PROBES.map(({ probe }) => probe(clean, timeoutMs)));
  const hit = results.find((r) => r !== null);
  return hit ? { ...hit, baseURL: clean } : null;
}

// Two listeners can front the same server (e.g. an app binding several ports).
// Identical kind + version + model list is treated as one runtime; the first kept wins.
export function dedupe(runtimes: RuntimeInfo[]): RuntimeInfo[] {
  const seen = new Set<string>();
  return runtimes.filter((r) => {
    if (!r.models.length) return true;
    const sig = `${r.kind}|${r.version ?? ""}|${[...r.models].sort().join(",")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// Local listening TCP ports (loopback or wildcard), via lsof. Unprivileged; only this
// user's processes are visible, which is exactly the set ah can talk to.
export async function listeningPorts(): Promise<number[]> {
  const lsof = Bun.which("lsof");
  if (lsof) {
    const proc = Bun.spawn([lsof, "-nP", "-iTCP", "-sTCP:LISTEN", "-Fn"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return parseLsof(out);
  }
  const ss = Bun.which("ss");
  if (ss) {
    const proc = Bun.spawn([ss, "-Htln"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return [...new Set([...out.matchAll(/(?:127\.0\.0\.1|\*|0\.0\.0\.0|\[::1?\]|\[::\]):(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  }
  return [];
}

export function parseLsof(out: string): number[] {
  const ports = new Set<number>();
  for (const line of out.split("\n")) {
    const m = line.match(/^n(127\.0\.0\.1|\*|localhost|\[::1\]|\[::\]|0\.0\.0\.0):(\d+)$/);
    if (m) ports.add(Number(m[2]));
  }
  return [...ports].sort((a, b) => a - b);
}

// Endpoints named by environment variables commonly set for local runtimes. Only the
// variable names are known; values always come from the user's environment.
export function envEndpoints(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!v || !/^(OLLAMA_HOST|[A-Z0-9_]*_(BASE_URL|HOST|ENDPOINT))$/.test(k)) continue;
    const url = /^https?:\/\//.test(v) ? v : `http://${v}`;
    try {
      const u = new URL(url);
      if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(u.hostname.replace(/^\[|\]$/g, ""))) out.push(u.origin.replace("0.0.0.0", "127.0.0.1"));
    } catch {
      /* not a URL */
    }
  }
  return out;
}

export interface DiscoverOptions {
  endpoints?: string[]; // from config
  scan?: boolean;
  timeoutMs?: number;
  concurrency?: number;
}

export async function discoverRuntimes(o: DiscoverOptions = {}): Promise<RuntimeInfo[]> {
  const candidates = new Map<string, RuntimeInfo["source"]>();
  for (const e of o.endpoints ?? []) candidates.set(e.replace(/\/+$/, "").replace(/\/v1$/, ""), "config");
  for (const e of envEndpoints()) if (!candidates.has(e)) candidates.set(e, "env");
  if (o.scan !== false)
    for (const p of await listeningPorts()) {
      const origin = `http://127.0.0.1:${p}`;
      const alreadyKnown = [...candidates.keys()].some((c) => new URL(c).port === String(p) && /127\.0\.0\.1|localhost/.test(c));
      if (!alreadyKnown) candidates.set(origin, "scan");
    }
  // Config and env first, then scanned ports in ascending order, so dedupe keeps the canonical one.
  const rank = { config: 0, env: 1, scan: 2 } as const;
  const entries = [...candidates.entries()].sort((x, y) => rank[x[1]] - rank[y[1]] || Number(new URL(x[0]).port) - Number(new URL(y[0]).port));
  const results: RuntimeInfo[] = [];
  const limit = o.concurrency ?? 16;
  for (let i = 0; i < entries.length; i += limit) {
    const batch = await Promise.all(
      entries.slice(i, i + limit).map(async ([origin, source]) => {
        const r = await fingerprint(origin, o.timeoutMs ?? 800);
        return r ? ({ ...r, source } as RuntimeInfo) : null;
      }),
    );
    results.push(...batch.filter((r): r is RuntimeInfo => r !== null));
  }
  return dedupe(results);
}

// Binaries of well-known runtimes found on PATH, so `ah doctor` can suggest starting them.
export function runtimeBinaries(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const p = Bun.which(n);
    if (p) out[n] = p;
  }
  return out;
}
