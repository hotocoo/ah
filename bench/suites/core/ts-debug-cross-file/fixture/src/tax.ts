import type { Cents } from "./types.ts";

// Tax in cents, rounded half-up to the nearest cent. `rate` is a fraction (0.0825).
export function taxFor(subtotal: Cents, rate: number): Cents {
  return Math.floor(subtotal * rate);
}
