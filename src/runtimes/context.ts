import type { LocalModelFacts } from "../core/types.ts";

export interface ContextInputs {
  facts?: LocalModelFacts;
  catalogContext?: number; // from models.dev / live listing
  desired?: number; // user config
  memTotalBytes: number;
  otherGpuAllocBytes?: number; // memory already held by other GPU users
  memFraction: number; // share of total memory ah may plan for (config)
  minContext: number; // floor below which an agent cannot work (config)
  kvBytesPerElement: number; // 2 for f16 KV cache (runtime default), 1 for q8
}

export interface ContextDecision {
  window: number;
  reason: string;
  kvBytesPerToken?: number;
  maxByMemory?: number;
}

export const kvBytesPerToken = (kv: NonNullable<LocalModelFacts["kv"]>, bytesPerElement: number) =>
  2 * kv.layers * kv.kvHeads * kv.headDim * bytesPerElement; // K and V

// Chooses the context window to request. Order: runtime-fixed value > user request
// capped by trained maximum and by what fits in memory next to the weights.
export function resolveContextWindow(i: ContextInputs): ContextDecision {
  if (i.facts?.fixedContext) return { window: i.facts.fixedContext, reason: "fixed by the runtime at load time" };
  const trained = i.facts?.trainedContext ?? i.catalogContext;
  let window = i.desired ?? trained;
  let reason = i.desired ? "user-configured" : "model's trained maximum";
  if (trained && window && window > trained) {
    window = trained;
    reason = "capped at the model's trained maximum";
  }
  let perToken: number | undefined;
  let maxByMemory: number | undefined;
  if (i.facts?.kv) {
    perToken = kvBytesPerToken(i.facts.kv, i.kvBytesPerElement);
    const budget = i.memTotalBytes * i.memFraction - (i.facts.sizeBytes ?? 0) - (i.otherGpuAllocBytes ?? 0);
    maxByMemory = Math.max(0, Math.floor(budget / perToken));
    if (window === undefined || window > maxByMemory) {
      window = Math.max(maxByMemory, i.minContext);
      reason = maxByMemory >= i.minContext ? "limited by available memory for the KV cache" : "memory is tight; using the minimum agent context";
    }
  }
  if (window === undefined) return { window: i.minContext, reason: "no metadata; using the minimum agent context" };
  // Round down to a multiple of 1024 so runtimes allocate aligned KV blocks.
  return { window: Math.max(1024, Math.floor(window / 1024) * 1024), reason, kvBytesPerToken: perToken, maxByMemory };
}
