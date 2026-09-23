import { cpus, loadavg, platform, totalmem, freemem } from "node:os";

// Point-in-time hardware state. Every field is optional: absent means "not measurable
// on this platform without privileges", never a guessed value.
export interface HardwareSample {
  t: number;
  gpuUtilPct?: number;
  gpuAllocBytes?: number; // memory reserved by the GPU driver (unified memory on Apple Silicon)
  gpuInUseBytes?: number;
  gpuName?: string;
  memTotalBytes: number;
  memFreeBytes: number;
  load1: number;
  cpuCount: number;
  powerW?: number; // total SoC/GPU power when a sudo-less source exists (macmon, nvidia-smi)
}

async function run(cmd: string[], timeoutMs = 3000): Promise<string | null> {
  const bin = Bun.which(cmd[0]!);
  if (!bin) return null;
  try {
    const p = Bun.spawn([bin, ...cmd.slice(1)], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const out = await new Response(p.stdout).text();
    clearTimeout(timer);
    return (await p.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

// Parses `ioreg -r -d 1 -c IOAccelerator` PerformanceStatistics (macOS, no sudo).
export function parseIoreg(out: string): Partial<HardwareSample> {
  const num = (key: string) => {
    const m = out.match(new RegExp(`"${key.replace(/[%]/g, "\\$&")}"=(\\d+)`));
    return m ? Number(m[1]) : undefined;
  };
  const name = out.match(/"model" = "([^"]+)"/)?.[1] ?? out.match(/"IOClass" = "([^"]+)"/)?.[1];
  return {
    gpuUtilPct: num("Device Utilization %"),
    gpuAllocBytes: num("Alloc system memory"),
    gpuInUseBytes: num("In use system memory"),
    gpuName: name,
  };
}

// Parses `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,power.draw,name --format=csv,noheader,nounits`.
export function parseNvidiaSmi(out: string): Partial<HardwareSample> {
  const rows = out.trim().split("\n").map((l) => l.split(",").map((x) => x.trim()));
  if (!rows.length || !rows[0]![0]) return {};
  const sum = (i: number) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  return {
    gpuUtilPct: sum(0) / rows.length,
    gpuInUseBytes: sum(1) * 1024 * 1024,
    gpuAllocBytes: sum(1) * 1024 * 1024,
    powerW: sum(3) || undefined,
    gpuName: rows.map((r) => r[4]).join(", "),
  };
}

export async function sampleHardware(): Promise<HardwareSample> {
  const base: HardwareSample = { t: Date.now(), memTotalBytes: totalmem(), memFreeBytes: freemem(), load1: loadavg()[0] ?? 0, cpuCount: cpus().length };
  if (platform() === "darwin") {
    const io = await run(["ioreg", "-r", "-d", "1", "-c", "IOAccelerator"]);
    const extra = io ? parseIoreg(io) : {};
    const mm = await run(["macmon", "pipe", "-s", "1"], 4000);
    let powerW: number | undefined;
    if (mm) {
      try {
        const j = JSON.parse(mm.trim().split("\n").pop()!) as { all_power?: number; sys_power?: number };
        powerW = j.all_power ?? j.sys_power;
      } catch {
        /* macmon format changed; skip power */
      }
    }
    return { ...base, ...extra, powerW };
  }
  const smi = await run(["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,power.draw,name", "--format=csv,noheader,nounits"]);
  return { ...base, ...(smi ? parseNvidiaSmi(smi) : {}) };
}

export interface HardwareStats {
  samples: number;
  gpuUtilAvg?: number;
  gpuUtilMax?: number;
  gpuMemPeakBytes?: number;
  powerAvgW?: number;
  energyJ?: number;
}

export function summarize(samples: HardwareSample[]): HardwareStats {
  const vals = (f: (s: HardwareSample) => number | undefined) => samples.map(f).filter((x): x is number => x !== undefined);
  const util = vals((s) => s.gpuUtilPct);
  const mem = vals((s) => s.gpuAllocBytes);
  const pow = vals((s) => s.powerW);
  const span = samples.length > 1 ? (samples.at(-1)!.t - samples[0]!.t) / 1000 : 0;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const powerAvgW = avg(pow);
  return {
    samples: samples.length,
    gpuUtilAvg: avg(util),
    gpuUtilMax: util.length ? Math.max(...util) : undefined,
    gpuMemPeakBytes: mem.length ? Math.max(...mem) : undefined,
    powerAvgW,
    energyJ: powerAvgW !== undefined && span > 0 ? powerAvgW * span : undefined,
  };
}

// Background sampler: collects samples at an interval while active.
export class HardwareSampler {
  private samples: HardwareSample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = false;

  constructor(private intervalMs = 1000) {}

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.inflight) return;
      this.inflight = true;
      try {
        this.samples.push(await sampleHardware());
      } finally {
        this.inflight = false;
      }
    };
    void tick();
    this.timer = setInterval(tick, this.intervalMs);
  }

  // Returns samples taken since `sinceMs` (epoch).
  window(sinceMs: number): HardwareSample[] {
    return this.samples.filter((s) => s.t >= sinceMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  all(): HardwareSample[] {
    return this.samples;
  }
}
