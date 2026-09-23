import type { ModelInfo, Usage } from "../core/types.ts";

export type Pricing = NonNullable<ModelInfo["cost"]>;

// USD cost of one response. Returns null when pricing is unknown, never a guess.
// Cache reads default to the input price and cache writes to 1.25x input when the
// catalog lacks a specific rate.
export function costOf(usage: Usage, price: Pricing | undefined): number | null {
  if (!price || price.input === undefined || price.output === undefined) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const cacheRead = price.cacheRead ?? price.input;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  return (
    (uncached * price.input + usage.cacheReadTokens * cacheRead + usage.cacheWriteTokens * cacheWrite + usage.outputTokens * price.output) /
    1_000_000
  );
}

export const addCost = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
