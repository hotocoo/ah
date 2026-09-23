// Statistics for benchmark trials.

// ln C(n, k), numerically stable for the sizes used here.
function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

// Unbiased pass@k (Chen et al., 2021): P(at least one of k samples passes)
// estimated from n trials with c passes: 1 - C(n-c, k) / C(n, k).
export function passAtK(n: number, c: number, k: number): number | null {
  if (n <= 0 || k <= 0 || k > n) return null;
  if (n - c < k) return 1;
  return 1 - Math.exp(lnChoose(n - c, k) - lnChoose(n, k));
}

// pass^k (Yao et al., 2024, tau-bench): P(all k samples pass) = C(c, k) / C(n, k).
export function passHatK(n: number, c: number, k: number): number | null {
  if (n <= 0 || k <= 0 || k > n) return null;
  if (c < k) return 0;
  return Math.exp(lnChoose(c, k) - lnChoose(n, k));
}

// Wilson score interval for a binomial proportion (default 95%).
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number; center: number } {
  if (n === 0) return { low: 0, high: 1, center: 0.5 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), center };
}

// A change is significant only when the two Wilson intervals do not overlap.
export function significantChange(a: { passes: number; n: number }, b: { passes: number; n: number }): "better" | "worse" | "same" {
  const wa = wilson(a.passes, a.n);
  const wb = wilson(b.passes, b.n);
  if (wb.low > wa.high) return "better";
  if (wb.high < wa.low) return "worse";
  return "same";
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function percentile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export function stddev(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
