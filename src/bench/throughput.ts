import type { RuntimeTimings, Usage } from "../core/types.ts";
import type { Provider } from "../providers/provider.ts";
import { mean, percentile, stddev } from "./stats.ts";

// Serving-path throughput benchmark (llama-bench style, but through the same API the
// agent uses): TTFT, prefill and decode speed at several prompt sizes.

export interface ThroughputPoint {
  promptTokensTarget: number;
  trial: number;
  ttftMs: number | null;
  totalMs: number;
  usage: Usage;
  timings?: RuntimeTimings;
  prefillTps: number | null; // runtime-reported, else prompt tokens / TTFT
  decodeTps: number | null; // runtime-reported, else output tokens / (total - TTFT)
}

export interface ThroughputSummary {
  promptTokensTarget: number;
  n: number;
  ttftMs: { mean: number | null; p50: number | null; p95: number | null };
  prefillTps: { mean: number | null; sd: number | null };
  decodeTps: { mean: number | null; sd: number | null };
}

// Deterministic code-like filler; a nonce first line defeats KV-cache reuse across trials.
export function syntheticPrompt(approxTokens: number, nonce: string): string {
  const unit = `function f${nonce.slice(0, 4)}(a, b) {\n  const s = a + b; // add\n  return s * 2;\n}\n`;
  const reps = Math.max(1, Math.ceil((approxTokens * 4) / unit.length));
  return `nonce: ${nonce}\n${unit.repeat(reps)}\nSummarize what the code above does in one sentence.`;
}

export async function measureThroughput(
  provider: Provider,
  model: string,
  opts: { promptSizes: number[]; genTokens: number; trials: number; contextWindow?: number; onPoint?: (p: ThroughputPoint) => void; signal?: AbortSignal },
): Promise<{ points: ThroughputPoint[]; summary: ThroughputSummary[] }> {
  const points: ThroughputPoint[] = [];
  for (const size of opts.promptSizes)
    for (let trial = 1; trial <= opts.trials; trial++) {
      const nonce = `${size}-${trial}-${Math.random().toString(36).slice(2, 10)}`;
      const t0 = performance.now();
      let ttft: number | null = null;
      let usage: Usage | undefined;
      let timings: RuntimeTimings | undefined;
      for await (const ev of provider.stream({
        model,
        system: "You are a concise assistant.",
        messages: [{ role: "user", content: [{ type: "text", text: syntheticPrompt(size, nonce) }] }],
        tools: [],
        maxTokens: opts.genTokens,
        temperature: 0,
        reasoning: "off",
        contextWindow: opts.contextWindow,
        signal: opts.signal,
      })) {
        if (ttft === null && (ev.type === "text_delta" || ev.type === "thinking_delta")) ttft = performance.now() - t0;
        if (ev.type === "done") {
          usage = ev.usage;
          timings = ev.timings;
        }
      }
      const totalMs = performance.now() - t0;
      const u = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
      const p: ThroughputPoint = {
        promptTokensTarget: size,
        trial,
        ttftMs: ttft,
        totalMs,
        usage: u,
        timings,
        prefillTps: timings?.prefillTokensPerSec ?? (ttft && u.inputTokens ? u.inputTokens / (ttft / 1000) : null),
        decodeTps: timings?.decodeTokensPerSec ?? (ttft !== null && u.outputTokens && totalMs > ttft ? u.outputTokens / ((totalMs - ttft) / 1000) : null),
      };
      points.push(p);
      opts.onPoint?.(p);
    }
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const summary = opts.promptSizes.map((size) => {
    const ps = points.filter((p) => p.promptTokensTarget === size);
    const ttft = nums(ps.map((p) => p.ttftMs));
    const pre = nums(ps.map((p) => p.prefillTps));
    const dec = nums(ps.map((p) => p.decodeTps));
    return {
      promptTokensTarget: size,
      n: ps.length,
      ttftMs: { mean: mean(ttft), p50: percentile(ttft, 0.5), p95: percentile(ttft, 0.95) },
      prefillTps: { mean: mean(pre), sd: stddev(pre) },
      decodeTps: { mean: mean(dec), sd: stddev(dec) },
    };
  });
  return { points, summary };
}

export function throughputMarkdown(model: string, summary: ThroughputSummary[], genTokens: number): string {
  const f = (x: number | null, d = 1) => (x === null ? "-" : x.toFixed(d));
  const rows = summary.map(
    (s) =>
      `| ${s.promptTokensTarget} | ${s.n} | ${f(s.ttftMs.p50, 0)} | ${f(s.ttftMs.p95, 0)} | ${f(s.prefillTps.mean)} ± ${f(s.prefillTps.sd)} | ${f(s.decodeTps.mean)} ± ${f(s.decodeTps.sd)} |`,
  );
  return `## Throughput: \`${model}\` (${genTokens} generated tokens per request)\n\n| prompt tokens | n | TTFT p50 ms | TTFT p95 ms | prefill tok/s | decode tok/s |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}
