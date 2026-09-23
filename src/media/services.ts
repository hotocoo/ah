import type { AhConfig } from "../config.ts";
import { parseModelRef } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { MediaServices } from "../tools/types.ts";
import { resolveImageBackend } from "./image.ts";
import { compileScene, designScene } from "./model3d.ts";

// Media services for the agent's generate_image / generate_3d tools.
// Image: configured `imageModel`, else a discovered local backend, else unavailable.
// 3D: procedural modelling with the configured `model3d` chat model, else the session's own model.
export function buildMedia(cfg: AhConfig, registry: ProviderRegistry, chat: { provider: string; model: string; contextWindow?: number }): MediaServices {
  const media: MediaServices = {};
  let backend = null;
  try {
    backend = resolveImageBackend(registry, cfg.imageModel);
  } catch {
    backend = null;
  }
  if (backend) {
    const b = backend;
    media.generateImage = async (prompt, opts) => {
      const [w, h] = (opts.size ?? `${cfg.image.width}x${cfg.image.height}`).split("x").map(Number);
      return b.generate(prompt, { ...cfg.image, width: w || cfg.image.width, height: h || cfg.image.height });
    };
  }
  const designer = cfg.model3d ? parseModelRef(cfg.model3d) : chat;
  if (registry.has(designer.provider)) {
    media.generate3d = async (prompt, opts) => {
      const scene = await designScene(registry.get(designer.provider), designer.model, prompt, { contextWindow: chat.contextWindow });
      return compileScene(scene, opts.format ?? "glb");
    };
  }
  return media;
}
