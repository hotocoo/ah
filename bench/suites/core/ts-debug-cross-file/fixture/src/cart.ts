import { taxFor } from "./tax.ts";
import type { Cents, Line } from "./types.ts";

export function subtotal(lines: Line[]): Cents {
  return lines.reduce((s, l) => s + l.unit * l.qty, 0);
}

export function total(lines: Line[], rate: number): Cents {
  const sub = subtotal(lines);
  return sub + taxFor(sub, rate);
}
