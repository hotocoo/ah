import type { RuntimeInfo } from "../runtimes/discover.ts";
import type { GeneratedImage } from "../providers/provider.ts";
import type { ProviderRegistry } from "../providers/registry.ts";

// Image generation backends. Local runtimes are discovered (ComfyUI, sdapi-compatible
// servers such as stable-diffusion.cpp / A1111 / Forge); any provider with an image API
// (OpenAI-compatible images endpoint, Gemini/Imagen, the mock) also works.

export interface ImageOptions {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  negative: string;
  seed?: number;
  signal?: AbortSignal;
}

export interface ImageBackend {
  ref: string; // e.g. comfyui/sdxl.safetensors, openai/gpt-image-1
  generate(prompt: string, o: ImageOptions): Promise<GeneratedImage[]>;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  // Diffusion runs can exceed Bun's default 300 s fetch timeout.
  const res = await fetch(url, { ...init, timeout: false } as RequestInit);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Minimal text-to-image graph from ComfyUI core nodes (API format).
export function comfyGraph(checkpoint: string, prompt: string, o: ImageOptions): Record<string, unknown> {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: o.negative, clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: o.width, height: o.height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed: o.seed ?? Math.floor(Math.random() * 2 ** 32), steps: o.steps, cfg: o.cfg, sampler_name: o.sampler, scheduler: o.scheduler, denoise: 1 },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "ah" } },
  };
}

export function comfyBackend(rt: RuntimeInfo, checkpoint: string, pollMs = 500): ImageBackend {
  return {
    ref: `comfyui/${checkpoint}`,
    async generate(prompt, o) {
      const queued = (await fetchJson(`${rt.baseURL}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: comfyGraph(checkpoint, prompt, o), client_id: "ah" }),
        signal: o.signal,
      })) as { prompt_id?: string; node_errors?: unknown };
      if (!queued.prompt_id) throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(queued.node_errors).slice(0, 300)}`);
      for (;;) {
        if (o.signal?.aborted) throw new Error("aborted");
        const h = (await fetchJson(`${rt.baseURL}/history/${queued.prompt_id}`, { signal: o.signal })) as Record<
          string,
          { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>; status?: { status_str?: string; messages?: unknown } }
        >;
        const entry = h[queued.prompt_id];
        if (entry?.status?.status_str === "error") throw new Error(`ComfyUI execution error: ${JSON.stringify(entry.status.messages).slice(0, 300)}`);
        const images = Object.values(entry?.outputs ?? {}).flatMap((x) => x.images ?? []);
        if (images.length)
          return Promise.all(
            images.map(async (im) => {
              const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder, type: im.type });
              const res = await fetch(`${rt.baseURL}/view?${q}`, { signal: o.signal });
              return { mediaType: res.headers.get("content-type") ?? "image/png", data: Buffer.from(await res.arrayBuffer()).toString("base64") };
            }),
          );
        await Bun.sleep(pollMs);
      }
    },
  };
}

export function sdapiBackend(rt: RuntimeInfo, model?: string): ImageBackend {
  return {
    ref: `sdapi/${model ?? rt.models[0] ?? "default"}`,
    async generate(prompt, o) {
      const j = (await fetchJson(`${rt.baseURL}/sdapi/v1/txt2img`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: o.negative,
          width: o.width,
          height: o.height,
          steps: o.steps,
          cfg_scale: o.cfg,
          seed: o.seed ?? -1,
          ...(model ? { override_settings: { sd_model_checkpoint: model } } : {}),
        }),
        signal: o.signal,
      })) as { images?: string[] };
      return (j.images ?? []).map((data) => ({ mediaType: "image/png", data }));
    },
  };
}

export function providerBackend(registry: ProviderRegistry, provider: string, model: string): ImageBackend {
  const p = registry.get(provider);
  if (!p.generateImage) throw new Error(`provider ${provider} has no image generation API`);
  return {
    ref: `${provider}/${model}`,
    generate: (prompt, o) => p.generateImage!({ model, prompt, size: `${o.width}x${o.height}`, signal: o.signal }),
  };
}

// Resolves the configured image model, or discovers a local backend.
export function resolveImageBackend(registry: ProviderRegistry, ref?: string): ImageBackend | null {
  const runtimes = [...registry.runtimes.entries()];
  if (ref) {
    const i = ref.indexOf("/");
    const [key, model] = i > 0 ? [ref.slice(0, i), ref.slice(i + 1)] : [ref, ""];
    const rt = registry.runtimes.get(key);
    if (rt?.kind === "comfyui") return comfyBackend(rt, model || rt.models[0]!);
    if (rt?.kind === "sdapi") return sdapiBackend(rt, model || undefined);
    return providerBackend(registry, key, model);
  }
  const comfy = runtimes.find(([, r]) => r.kind === "comfyui" && r.models.length);
  if (comfy) return comfyBackend(comfy[1], comfy[1].models[0]!);
  const sd = runtimes.find(([, r]) => r.kind === "sdapi");
  if (sd) return sdapiBackend(sd[1]);
  return null;
}
