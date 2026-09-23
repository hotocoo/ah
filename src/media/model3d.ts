import { textOf } from "../core/types.ts";
import type { Provider } from "../providers/provider.ts";
import { validate } from "../tools/schema.ts";
import type { JsonSchema } from "../core/types.ts";
import { buildScene, exportScene, SHAPES, type Scene } from "./mesh.ts";
import { renderPreview } from "./render3d.ts";

// Procedural 3D modelling: the language model designs a scene from primitives, ah
// compiles it into a real mesh file and renders a preview. Keyless, runs on any chat model.

const VEC3: JsonSchema = { type: "array", items: { type: "number" } };
export const SCENE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          shape: { type: "string", enum: SHAPES },
          size: VEC3,
          radius: { type: "number" },
          height: { type: "number" },
          tube: { type: "number" },
          segments: { type: "integer" },
          position: VEC3,
          rotation: VEC3,
          scale: VEC3,
          color: { type: "string" },
        },
        required: ["shape"],
      },
    },
  },
  required: ["objects"],
};

const SYSTEM = `You are a 3D modeller. Build the requested object from primitives and reply with ONLY a JSON object (no prose, no code fence) matching:
{"name": string, "objects": [{"name": string, "shape": ${SHAPES.map((s) => `"${s}"`).join("|")}, "size": [x,y,z] (box/plane), "radius": number, "height": number, "tube": number (torus), "position": [x,y,z], "rotation": [degX,degY,degZ], "scale": [x,y,z], "color": "#rrggbb"}]}
Units are metres, +Y is up, the object rests on y=0. Cylinders, cones and capsules are centred on their position along Y. Use 3-40 primitives, realistic proportions and colours, and make parts touch so the model is connected.`;

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : text).replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

export function parseScene(text: string): Scene {
  const scene = extractJson(text);
  const errors = validate(SCENE_SCHEMA, scene);
  if (errors.length) throw new Error(`invalid scene: ${errors.slice(0, 5).join("; ")}`);
  const s = scene as Scene;
  if (!s.objects.length) throw new Error("scene has no objects");
  return s;
}

export async function designScene(provider: Provider, model: string, prompt: string, opts: { contextWindow?: number; signal?: AbortSignal; attempts?: number } = {}): Promise<Scene> {
  let lastErr = "";
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: `Model: ${prompt}` }] }];
  for (let i = 0; i < (opts.attempts ?? 3); i++) {
    let result = "";
    for await (const ev of provider.stream({
      model,
      system: SYSTEM,
      messages: lastErr ? [...messages, { role: "assistant", content: [{ type: "text", text: result || "(invalid)" }] }, { role: "user", content: [{ type: "text", text: `That was not valid: ${lastErr}. Reply with only the corrected JSON.` }] }] : messages,
      tools: [],
      maxTokens: 8192,
      reasoning: "off",
      contextWindow: opts.contextWindow,
      signal: opts.signal,
    }))
      if (ev.type === "done") result = textOf(ev.message);
    try {
      return parseScene(result);
    } catch (err) {
      lastErr = (err as Error).message;
    }
  }
  throw new Error(`3D scene generation failed: ${lastErr}`);
}

export interface Generated3d {
  data: Buffer;
  format: string;
  preview: string; // base64 PNG
  scene: Scene;
  triangles: number;
}

export function compileScene(scene: Scene, format: string): Generated3d {
  const meshes = buildScene(scene);
  return {
    data: exportScene(meshes, format, scene.name),
    format,
    preview: renderPreview(meshes).toString("base64"),
    scene,
    triangles: meshes.reduce((a, m) => a + m.indices.length / 3, 0),
  };
}
