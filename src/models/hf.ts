import type { TelemetryStore } from "../telemetry/store.ts";

// Model-card metadata from the Hugging Face Hub, so ah serves a model with the settings
// its authors recommend instead of runtime defaults:
// - sampling defaults from generation_config.json,
// - whether the chat template has an `enable_thinking` switch.
// Quantised repos (GGUF, MLX) often lack generation_config.json; the card's
// `base_model` is followed (up to two hops).

export interface ModelCardDefaults {
  repo: string; // repo the values came from
  sampling: { temperature?: number; topP?: number; topK?: number; minP?: number };
  templateThinkingToggle: boolean;
}

const HUB = "https://huggingface.co";
const WEEK = 7 * 86_400_000;

// Extracts a Hub repo id from a runtime model id or path:
// "ggml-org/X-GGUF:Q8_0", ".../models--ggml-org--X-GGUF/snapshots/...", "mlx-community/X".
export function hubRepoFrom(s: string | undefined): string | null {
  if (!s) return null;
  const cache = s.match(/models--([^/]+?)--([^/]+)/);
  if (cache) return `${cache[1]}/${cache[2]}`;
  const m = s.match(/^([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?::[\w.-]+)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function getText(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

export function samplingFrom(gen: Record<string, unknown> | null): ModelCardDefaults["sampling"] {
  if (!gen) return {};
  const n = (k: string) => (typeof gen[k] === "number" ? (gen[k] as number) : undefined);
  return { temperature: n("temperature"), topP: n("top_p"), topK: n("top_k"), minP: n("min_p") };
}

export async function modelCardDefaults(repo: string, o: { store?: TelemetryStore | null; fetchImpl?: typeof fetch } = {}): Promise<ModelCardDefaults | null> {
  const key = `hfcard:${repo}`;
  const cached = o.store?.cacheGet(key, WEEK);
  if (cached) return JSON.parse(cached) as ModelCardDefaults | null;
  const f = o.fetchImpl ?? fetch;
  let current: string | null = repo;
  let result: ModelCardDefaults | null = null;
  let toggle = false;
  for (let hop = 0; current && hop < 3; hop++) {
    const repoNow: string = current;
    const [gen, tmpl, tok, info]: [unknown, string | null, unknown, unknown] = await Promise.all([
      getJson(`${HUB}/${repoNow}/raw/main/generation_config.json`, f),
      getText(`${HUB}/${repoNow}/raw/main/chat_template.jinja`, f),
      getJson(`${HUB}/${repoNow}/raw/main/tokenizer_config.json`, f),
      getJson(`${HUB}/api/models/${repoNow}`, f),
    ]);
    const template = tmpl ?? ((tok as { chat_template?: unknown } | null)?.chat_template as string | undefined) ?? "";
    toggle ||= typeof template === "string" && template.includes("enable_thinking");
    const sampling = samplingFrom(gen as Record<string, unknown> | null);
    if (Object.values(sampling).some((v) => v !== undefined)) {
      result = { repo: repoNow, sampling, templateThinkingToggle: toggle };
      break;
    }
    const base: string | string[] | undefined = (info as { cardData?: { base_model?: string | string[] } } | null)?.cardData?.base_model;
    current = Array.isArray(base) ? (base[0] ?? null) : (base ?? null);
  }
  if (!result && toggle) result = { repo, sampling: {}, templateThinkingToggle: true };
  o.store?.cacheSet(key, JSON.stringify(result));
  return result;
}
