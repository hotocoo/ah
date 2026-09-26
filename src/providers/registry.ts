import type { AhConfig, ProviderConfig } from "../config.ts";
import type { RuntimeInfo } from "../runtimes/discover.ts";
import type { TelemetryStore } from "../telemetry/store.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { MockProvider } from "./mock.ts";
import { OllamaProvider } from "./ollama.ts";
import { OpenAICompatProvider, type WireFormat } from "./openai-compat.ts";
import type { Provider } from "./provider.ts";

// Providers come from four sources, none of them a built-in vendor list:
// 1. runtimes discovered on this machine (src/runtimes/discover.ts),
// 2. cloud providers described by the models.dev catalog whose API-key env var is set,
// 3. explicit entries in the user's config,
// 4. the deterministic mock provider (tests and offline benchmarks).

const resolveKey = (c: ProviderConfig): string | undefined => c.apiKey ?? (c.apiKeyEnv ? process.env[c.apiKeyEnv] : undefined);

interface ProviderContext {
  store?: TelemetryStore | null;
}

// Wire formats are learned per provider and model: a chat template's accepted effort
// values belong to that model, not to the server.
function wireFor(key: string, ctx: ProviderContext) {
  return {
    loadWire: (model: string) => {
      const saved = ctx.store?.cacheGet(`wire:${key}:${model}`, Number.POSITIVE_INFINITY);
      return saved ? (JSON.parse(saved) as WireFormat) : undefined;
    },
    onWireChange: (w: WireFormat, model: string) => ctx.store?.cacheSet(`wire:${key}:${model}`, JSON.stringify(w)),
  };
}

export function createProvider(key: string, c: ProviderConfig, ctx: ProviderContext = {}, meta?: RuntimeInfo["meta"]): Provider | null {
  const apiKey = resolveKey(c);
  switch (c.kind) {
    case "anthropic":
      return new AnthropicProvider(key, { apiKey, baseURL: c.baseURL, serverFallbacks: c.serverFallbacks });
    case "openai-compatible":
    case "llamacpp":
    case "lmstudio": {
      if (!c.baseURL) return null;
      const base = /\/v\d+\/?$/.test(c.baseURL) ? c.baseURL : `${c.baseURL.replace(/\/$/, "")}/v1`;
      const modalities = meta?.modalities as { vision?: boolean } | undefined;
      return new OpenAICompatProvider(key, {
        baseURL: base,
        apiKey,
        headers: c.headers,
        imageGen: c.imageGen,
        ...wireFor(key, ctx),
        modelMeta: meta
          ? { contextWindow: typeof meta.nCtx === "number" ? meta.nCtx : undefined, toolCall: meta.hasToolTemplate as boolean | undefined, vision: modalities?.vision }
          : undefined,
      });
    }
    case "gemini":
      return new GeminiProvider(key, apiKey ?? "", c.baseURL);
    case "ollama":
      return new OllamaProvider(key, c.baseURL);
    case "mock":
      return new MockProvider();
    default:
      return null;
  }
}

// models.dev `npm` package -> ah adapter. Unknown SDK packages are OpenAI-compatible when
// the provider publishes an API base URL, otherwise unsupported.
export function adapterForNpm(npm: string | undefined, api: string | undefined): ProviderConfig["kind"] | null {
  if (!npm) return api ? "openai-compatible" : null;
  if (npm.includes("anthropic")) return "anthropic";
  if (/@ai-sdk\/google$/.test(npm)) return "gemini";
  if (/bedrock|vertex|azure/.test(npm)) return null; // need cloud SDK auth, not supported
  return api || npm.includes("openai") ? "openai-compatible" : null;
}

interface ModelsDevProvider {
  id: string;
  name?: string;
  env?: string[];
  npm?: string;
  api?: string;
}

// Cloud providers from the models.dev catalog that have credentials in the environment.
export function cloudProvidersFromCatalog(catalog: Record<string, ModelsDevProvider>, env = process.env): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  for (const [id, p] of Object.entries(catalog)) {
    const keyVar = (p.env ?? []).find((v) => env[v]);
    if (!keyVar) continue;
    const kind = adapterForNpm(p.npm, p.api);
    if (!kind) continue;
    if (kind === "openai-compatible" && !p.api) continue;
    out[id] = { kind, baseURL: p.api, apiKeyEnv: keyVar };
  }
  return out;
}

export function runtimeProviderKey(r: RuntimeInfo, taken: Set<string>): string {
  const base = r.kind;
  if (!taken.has(base)) return base;
  return `${base}-${new URL(r.baseURL).port}`;
}

// Runtime keys depend on which servers are up ("llamacpp" for the first llama.cpp server,
// "llamacpp-8081" for the next). A ref saved while two servers ran must still resolve when one
// stops, so every runtime also answers to "<kind>-<port>". Lookups only; listings are unchanged.
class AliasMap<V> extends Map<string, V> {
  constructor(private alias: Map<string, string>) {
    super();
  }
  override get(k: string): V | undefined {
    return super.get(k) ?? super.get(this.alias.get(k) ?? "");
  }
  override has(k: string): boolean {
    return super.has(k) || (this.alias.has(k) && super.has(this.alias.get(k)!));
  }
}

export class ProviderRegistry {
  private aliases = new Map<string, string>();
  private providers = new AliasMap<Provider>(this.aliases);
  readonly runtimes = new AliasMap<RuntimeInfo>(this.aliases);

  static build(opts: {
    cfg: AhConfig;
    runtimes?: RuntimeInfo[];
    catalog?: Record<string, ModelsDevProvider> | null;
    store?: TelemetryStore | null;
  }): ProviderRegistry {
    const reg = new ProviderRegistry();
    const ctx = { store: opts.store };
    reg.register(new MockProvider());
    for (const r of opts.runtimes ?? []) {
      if (r.kind === "comfyui" || r.kind === "sdapi") {
        reg.runtimes.set(runtimeProviderKey(r, new Set(reg.runtimes.keys())), r);
        continue;
      }
      const key = runtimeProviderKey(r, new Set([...reg.providers.keys(), ...reg.runtimes.keys()]));
      const p = createProvider(key, { kind: r.kind, baseURL: r.baseURL }, ctx, r.meta);
      if (p) {
        reg.register(p);
        reg.runtimes.set(key, r);
        const port = `${r.kind}-${new URL(r.baseURL).port}`;
        if (port !== key) reg.aliases.set(port, key);
      }
    }
    for (const [key, c] of Object.entries(opts.catalog ? cloudProvidersFromCatalog(opts.catalog) : {})) {
      if (opts.cfg.providers[key]?.enabled === false || reg.has(key)) continue;
      const p = createProvider(key, c, ctx);
      if (p) reg.register(p);
    }
    for (const [key, c] of Object.entries(opts.cfg.providers)) {
      if (c.enabled === false) {
        reg.providers.delete(key);
        continue;
      }
      const p = createProvider(key, c, ctx);
      if (p) reg.register(p);
    }
    return reg;
  }

  register(p: Provider): void {
    this.providers.set(p.key, p);
  }

  get(key: string): Provider {
    const p = this.providers.get(key);
    if (!p) throw new Error(`provider "${key}" is not available. Available: ${[...this.providers.keys()].join(", ")}. Run \`ah doctor\` to see discovered runtimes.`);
    return p;
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }
}
