import { describe, expect, test } from "bun:test";
import { comfyBackend, comfyGraph, sdapiBackend } from "../src/media/image.ts";
import { buildMesh, buildScene, exportScene, toGlb, toObj, toStl, type Scene } from "../src/media/mesh.ts";
import { compileScene, designScene, extractJson, parseScene } from "../src/media/model3d.ts";
import { renderPreview } from "../src/media/render3d.ts";
import { MockProvider } from "../src/providers/mock.ts";

const scene: Scene = {
  name: "demo",
  objects: [
    { shape: "box", size: [2, 1, 1], position: [0, 0.5, 0], color: "#ff0000" },
    { shape: "sphere", radius: 0.5, position: [0, 1.5, 0] },
    { shape: "cylinder", radius: 0.2, height: 1, rotation: [90, 0, 0] },
    { shape: "cone", radius: 0.3, height: 0.5 },
    { shape: "torus", radius: 0.5, tube: 0.1 },
    { shape: "plane", size: [3, 0, 3] },
    { shape: "capsule", radius: 0.2, height: 0.6 },
  ],
};

describe("mesh building", () => {
  test("box has 12 triangles and correct bounds after transform", () => {
    const m = buildMesh({ shape: "box", size: [2, 1, 1], position: [0, 0.5, 0] });
    expect(m.indices.length / 3).toBe(12);
    const ys = m.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(1);
  });

  test("normals are unit length; rotation is applied", () => {
    const m = buildMesh({ shape: "cylinder", radius: 0.2, height: 1, rotation: [90, 0, 0] });
    for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!)).toBeCloseTo(1, 4);
    const zs = m.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1, 3); // height now along Z
  });

  test("every shape builds with valid indices", () => {
    for (const m of buildScene(scene)) {
      const n = m.positions.length / 3;
      expect(m.indices.length % 3).toBe(0);
      expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
    }
  });
});

describe("exporters", () => {
  const meshes = buildScene(scene);
  const tris = meshes.reduce((a, m) => a + m.indices.length / 3, 0);

  test("GLB: magic, version, chunk layout, parseable JSON", () => {
    const glb = toGlb(meshes, "demo");
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    const jsonLen = glb.readUInt32LE(12);
    expect(glb.readUInt32LE(16)).toBe(0x4e4f534a);
    const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes).toHaveLength(7);
    const binHeader = 20 + jsonLen;
    expect(glb.readUInt32LE(binHeader + 4)).toBe(0x004e4942);
    expect(glb.readUInt32LE(binHeader)).toBe(json.buffers[0].byteLength);
    // Every bufferView fits in the binary chunk and is 4-byte aligned.
    for (const bv of json.bufferViews) {
      expect(bv.byteOffset % 4).toBe(0);
      expect(bv.byteOffset + bv.byteLength).toBeLessThanOrEqual(json.buffers[0].byteLength);
    }
  });

  test("STL triangle count and size", () => {
    const stl = toStl(meshes);
    expect(stl.readUInt32LE(80)).toBe(tris);
    expect(stl.length).toBe(84 + tris * 50);
  });

  test("OBJ face count", () => {
    const obj = toObj(meshes);
    expect(obj.split("\n").filter((l) => l.startsWith("f ")).length).toBe(tris);
  });

  test("glTF embeds the buffer as a data URI; unknown formats throw", () => {
    const gltf = JSON.parse(exportScene(meshes, "gltf").toString());
    expect(gltf.buffers[0].uri).toStartWith("data:application/octet-stream;base64,");
    expect(() => exportScene(meshes, "fbx")).toThrow(/unsupported/);
  });

  test("preview renders a PNG with non-background pixels", () => {
    const png = renderPreview(meshes, 64, 64);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(png.length).toBeGreaterThan(500);
  });
});

describe("scene design", () => {
  test("extractJson handles fences and think blocks", () => {
    expect(extractJson('<think>{"x":1}</think>Here:\n```json\n{"objects":[]}\n```')).toEqual({ objects: [] });
    expect(() => parseScene('{"objects":[{"shape":"blob"}]}')).toThrow(/invalid scene/);
  });

  test("designScene retries with feedback until the scene is valid", async () => {
    const mock = new MockProvider({ script: [{ text: "a chair!" }, { text: JSON.stringify(scene) }] });
    const s = await designScene(mock, "scripted", "a chair");
    expect(s.objects).toHaveLength(7);
    const g = compileScene(s, "stl");
    expect(g.triangles).toBeGreaterThan(100);
    expect(g.preview.length).toBeGreaterThan(100);
  });
});

describe("image backends", () => {
  const opts = { width: 64, height: 64, steps: 2, cfg: 5, sampler: "euler", scheduler: "normal", negative: "bad" };

  test("comfyGraph wires core nodes", () => {
    const g = comfyGraph("m.safetensors", "a cat", opts) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(g["1"]!.inputs.ckpt_name).toBe("m.safetensors");
    expect(g["2"]!.inputs.text).toBe("a cat");
    expect(g["5"]!.inputs.steps).toBe(2);
    expect(g["7"]!.class_type).toBe("SaveImage");
  });

  test("comfy backend: queue, poll history, fetch /view", async () => {
    let polls = 0;
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/prompt") return Response.json({ prompt_id: "p1", number: 0 });
        if (u.pathname === "/history/p1")
          return Response.json(++polls < 2 ? {} : { p1: { outputs: { "7": { images: [{ filename: "ah_1.png", subfolder: "", type: "output" }] } }, status: { status_str: "success" } } });
        if (u.pathname === "/view" && u.searchParams.get("filename") === "ah_1.png") return new Response(png, { headers: { "content-type": "image/png" } });
        return new Response("nf", { status: 404 });
      },
    });
    try {
      const b = comfyBackend({ kind: "comfyui", baseURL: `http://127.0.0.1:${server.port}`, source: "scan", models: ["m"], meta: {} }, "m", 10);
      const [img] = await b.generate("a cat", opts);
      expect(Buffer.from(img!.data, "base64")).toEqual(png);
      expect(polls).toBe(2);
    } finally {
      server.stop(true);
    }
  });

  test("sdapi backend posts txt2img", async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({ port: 0, fetch: async (r) => ((body = (await r.json()) as Record<string, unknown>), Response.json({ images: ["QUJD"] })) });
    try {
      const [img] = await sdapiBackend({ kind: "sdapi", baseURL: `http://127.0.0.1:${server.port}`, source: "scan", models: [], meta: {} }).generate("x", opts);
      expect(img!.data).toBe("QUJD");
      expect(body).toMatchObject({ prompt: "x", width: 64, steps: 2, cfg_scale: 5 });
    } finally {
      server.stop(true);
    }
  });
});
