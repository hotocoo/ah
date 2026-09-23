import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { autoSelectModel, buildEnvironment, resolveModelContext } from "../app/session.ts";
import { parseModelRef } from "../config.ts";
import { resolveImageBackend } from "../media/image.ts";
import { compileScene, designScene, parseScene } from "../media/model3d.ts";
import { dim, green, red } from "./render.ts";

export async function cmdMedia(kind: string, argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: { out: { type: "string", short: "o" }, model: { type: "string", short: "m" }, size: { type: "string" }, scene: { type: "string" }, steps: { type: "string" } },
  });
  const prompt = positionals.join(" ").trim();
  const out = resolve((v.out as string | undefined) ?? (kind === "image" ? "image.png" : "model.glb"));
  if (!prompt && !v.scene) {
    process.stderr.write(red(`usage: ah ${kind} "<prompt>" -o ${kind === "image" ? "out.png" : "out.glb"}\n`));
    return 2;
  }
  const env = await buildEnvironment({});
  mkdirSync(dirname(out), { recursive: true });
  const t0 = performance.now();
  if (kind === "image") {
    const backend = resolveImageBackend(env.registry, (v.model as string | undefined) ?? env.cfg.imageModel);
    if (!backend) {
      process.stderr.write(red("no image backend found: start ComfyUI or an sdapi server (stable-diffusion.cpp, A1111), or set imageModel.\n"));
      return 2;
    }
    const [w, h] = String(v.size ?? `${env.cfg.image.width}x${env.cfg.image.height}`).split("x").map(Number);
    const imgs = await backend.generate(prompt, { ...env.cfg.image, width: w!, height: h!, steps: v.steps ? Number(v.steps) : env.cfg.image.steps });
    if (!imgs[0]) throw new Error("backend returned no image");
    writeFileSync(out, Buffer.from(imgs[0].data, "base64"));
    process.stdout.write(`${green("saved")} ${out} ${dim(`(${backend.ref}, ${((performance.now() - t0) / 1000).toFixed(1)}s)`)}\n`);
    return 0;
  }
  const format = extname(out).slice(1).toLowerCase() || "glb";
  let scene;
  if (v.scene) scene = parseScene(readFileSync(v.scene as string, "utf8"));
  else {
    const ref = (v.model as string | undefined) ?? env.cfg.model3d ?? env.cfg.defaultModel ?? autoSelectModel(env);
    if (!ref) throw new Error("no chat model available to design the scene (see `ah doctor`)");
    const { provider, model } = parseModelRef(ref);
    process.stderr.write(dim(`designing with ${ref}...\n`));
    const { context } = await resolveModelContext(env, ref);
    scene = await designScene(env.registry.get(provider), model, prompt, { contextWindow: context.window });
  }
  const g = compileScene(scene, format);
  writeFileSync(out, g.data);
  const previewPath = out.replace(/\.[^.]+$/, "") + ".preview.png";
  writeFileSync(previewPath, Buffer.from(g.preview, "base64"));
  writeFileSync(out.replace(/\.[^.]+$/, "") + ".scene.json", JSON.stringify(scene, null, 2));
  process.stdout.write(`${green("saved")} ${out} ${dim(`(${g.format}, ${scene.objects.length} parts, ${g.triangles} triangles, ${((performance.now() - t0) / 1000).toFixed(1)}s)`)}\n${green("preview")} ${previewPath}\n`);
  return 0;
}
