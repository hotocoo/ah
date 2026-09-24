import { describe, expect, test } from "bun:test";
import { kvBytesPerToken, resolveContextWindow } from "../src/runtimes/context.ts";
import { dedupe, dropInternalWorkers, envEndpoints, fingerprint, parseLsof, parseLsofListeners, type RuntimeInfo } from "../src/runtimes/discover.ts";
import { parseIoreg, parseNvidiaSmi, summarize } from "../src/runtimes/hardware.ts";
import { ToolRegistry } from "../src/tools/index.ts";

const GB = 1024 ** 3;
const base = { memTotalBytes: 64 * GB, memFraction: 0.75, minContext: 16_384, kvBytesPerElement: 2 };
const kv = { layers: 28, kvHeads: 8, headDim: 128 };

describe("context sizing", () => {
  test("kv bytes per token = 2 (K,V) x layers x kvHeads x headDim x bytes", () => {
    expect(kvBytesPerToken(kv, 2)).toBe(2 * 28 * 8 * 128 * 2);
  });

  test("runtime-fixed context wins", () => {
    expect(resolveContextWindow({ ...base, facts: { runtime: "x", fixedContext: 12345 }, desired: 99999 }).window).toBe(12345);
  });

  test("desired is capped by trained maximum, then rounded to a power of two", () => {
    const d = resolveContextWindow({ ...base, facts: { runtime: "x", trainedContext: 40960 }, desired: 1_000_000 });
    expect(d.window).toBe(32768);
    expect(d.reason).toMatch(/power|trained/);
  });

  test("memory limits the window next to the weights", () => {
    const big = { runtime: "x", trainedContext: 1_000_000, sizeBytes: 40 * GB, kv: { layers: 64, kvHeads: 8, headDim: 128 } };
    const d = resolveContextWindow({ ...base, facts: big });
    // budget 48 GB - 40 GB = 8 GB; 256 KiB/token -> 32768 tokens
    expect(d.maxByMemory).toBe(32768);
    expect(d.window).toBe(32768);
    expect(d.reason).toMatch(/memory/);
  });

  test("floors at minContext when memory is tight", () => {
    const d = resolveContextWindow({ ...base, facts: { runtime: "x", trainedContext: 100_000, sizeBytes: 47 * GB, kv }, otherGpuAllocBytes: 2 * GB });
    expect(d.window).toBe(16384);
    expect(d.reason).toMatch(/tight/);
  });

  test("no metadata -> minimum agent context", () => {
    expect(resolveContextWindow({ ...base }).window).toBe(16384);
  });
});

describe("discovery helpers", () => {
  test("parseLsof keeps loopback/wildcard listeners only", () => {
    const out = "p123\nn*:8080\nn127.0.0.1:11434\nn192.168.1.5:9000\nn[::1]:5000\nn127.0.0.1:11434\n";
    expect(parseLsof(out)).toEqual([5000, 8080, 11434]);
  });

  test("parseLsofListeners attaches owning pid; internal workers are dropped", () => {
    expect(parseLsofListeners("p10\nf3\nn127.0.0.1:11434\np20\nf4\nn127.0.0.1:64392\n")).toEqual([
      { port: 11434, pid: 10 },
      { port: 64392, pid: 20 },
    ]);
    const rt = (kind: "ollama" | "llamacpp", port: number, pid: number, ppid: number) => ({ kind, baseURL: `http://127.0.0.1:${port}`, source: "scan" as const, models: [], meta: {}, pid, ppid });
    // ollama app (pid 5, :61071) -> ollama serve (pid 10, :11434) -> llama.cpp runner (pid 20)
    const kept = dropInternalWorkers([rt("ollama", 61071, 5, 1), rt("ollama", 11434, 10, 5), rt("llamacpp", 64392, 20, 10), rt("llamacpp", 8080, 30, 1)]);
    expect(kept.map((r) => new URL(r.baseURL).port)).toEqual(["61071", "11434", "8080"]);
  });

  test("envEndpoints reads *_HOST/*_BASE_URL pointing at localhost", () => {
    expect(
      envEndpoints({ OLLAMA_HOST: "0.0.0.0:11434", MY_BASE_URL: "http://localhost:9999/v1", REMOTE_HOST: "https://api.example.com", PATH: "/bin" }),
    ).toEqual(["http://127.0.0.1:11434", "http://localhost:9999"]);
  });

  test("dedupe drops identical listeners but keeps empty runtimes", () => {
    const r = (port: number, models: string[]): RuntimeInfo => ({ kind: "ollama", baseURL: `http://127.0.0.1:${port}`, source: "scan", version: "1", models, meta: {} });
    expect(dedupe([r(1, ["a"]), r(2, ["a"]), r(3, []), r(4, [])]).map((x) => x.baseURL)).toEqual(["http://127.0.0.1:1", "http://127.0.0.1:3", "http://127.0.0.1:4"]);
  });

  test("fingerprint prefers specific signatures over generic /v1/models", async () => {
    const fake = (routes: Record<string, unknown>) =>
      Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname in routes ? Response.json(routes[new URL(req.url).pathname]) : new Response("nf", { status: 404 })) });
    const ollama = fake({ "/api/version": { version: "9.9" }, "/api/tags": { models: [{ name: "m1" }] }, "/v1/models": { data: [{ id: "m1" }] } });
    const llama = fake({ "/props": { default_generation_settings: { n_ctx: 8192 }, build_info: "b1", chat_template: "{{ tools }}" }, "/v1/models": { data: [{ id: "g" }] } });
    const generic = fake({ "/v1/models": { data: [{ id: "x" }] } });
    const comfy = fake({ "/system_stats": { system: { comfyui_version: "1.0" }, devices: [] }, "/models/checkpoints": ["sd.safetensors"] });
    try {
      expect(await fingerprint(`http://127.0.0.1:${ollama.port}`)).toMatchObject({ kind: "ollama", version: "9.9", models: ["m1"] });
      expect(await fingerprint(`http://127.0.0.1:${llama.port}/v1`)).toMatchObject({ kind: "llamacpp", meta: { nCtx: 8192, hasToolTemplate: true } });
      expect(await fingerprint(`http://127.0.0.1:${generic.port}`)).toMatchObject({ kind: "openai-compatible", models: ["x"] });
      expect(await fingerprint(`http://127.0.0.1:${comfy.port}`)).toMatchObject({ kind: "comfyui", models: ["sd.safetensors"] });
      expect(await fingerprint("http://127.0.0.1:1", 200)).toBeNull();
    } finally {
      [ollama, llama, generic, comfy].forEach((s) => s.stop(true));
    }
  });
});

describe("hardware parsing", () => {
  test("parseIoreg reads PerformanceStatistics", () => {
    const out = `"PerformanceStatistics" = {"In use system memory"=39675183104,"Device Utilization %"=99,"Alloc system memory"=42630791168}\n"model" = "Apple M4 Max"`;
    expect(parseIoreg(out)).toEqual({ gpuUtilPct: 99, gpuAllocBytes: 42630791168, gpuInUseBytes: 39675183104, gpuName: "Apple M4 Max" });
  });

  test("parseNvidiaSmi sums GPUs", () => {
    const h = parseNvidiaSmi("50, 1000, 24000, 200.5, RTX A\n30, 2000, 24000, 100.5, RTX B\n");
    expect(h.gpuUtilPct).toBe(40);
    expect(h.gpuInUseBytes).toBe(3000 * 1024 * 1024);
    expect(h.powerW).toBeCloseTo(301);
  });

  test("summarize computes averages, peaks and energy", () => {
    const s = (t: number, u: number, p: number) => ({ t, gpuUtilPct: u, gpuAllocBytes: u * 10, powerW: p, memTotalBytes: 1, memFreeBytes: 1, load1: 0, cpuCount: 1 });
    const r = summarize([s(0, 50, 10), s(2000, 100, 30)]);
    expect(r).toMatchObject({ samples: 2, gpuUtilAvg: 75, gpuUtilMax: 100, gpuMemPeakBytes: 1000, powerAvgW: 20, energyJ: 40 });
  });
});

describe("tool availability", () => {
  test("media and git tools are hidden without their backend; compact drops optional tools", () => {
    const reg = new ToolRegistry();
    const ctx = { root: "/nonexistent-root", bashTimeoutMs: 1, todos: [], readFiles: new Set<string>(), media: {} };
    const names = reg.specs("auto", ctx).map((s) => s.name);
    expect(names).not.toContain("generate_image");
    expect(names).not.toContain("generate_3d");
    expect(names).not.toContain("git_status");
    const withMedia = reg.specs("auto", { ...ctx, media: { generateImage: async () => [] } }).map((s) => s.name);
    expect(withMedia).toContain("generate_image");
    const compact = reg.specs("auto", ctx, true).map((s) => s.name);
    expect(compact).not.toContain("repo_map");
    expect(compact).toContain("edit_file");
    expect(compact).toContain("bash");
  });
});

describe("runtime product name", () => {
  test("taken from a plain-text banner or the Server header, never guessed", async () => {
    const { productName } = await import("../src/runtimes/discover.ts");
    expect(productName(null, "Docker Model Runner\n\nThe service is running.\n")).toBe("Docker Model Runner");
    expect(productName("llama.cpp", "")).toBe("llama.cpp");
    expect(productName(null, "<html>")).toBeUndefined();
    expect(productName(null, "")).toBeUndefined();
  });
});
