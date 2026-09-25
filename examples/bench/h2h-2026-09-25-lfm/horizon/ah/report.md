# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T09-42-43_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T09:42:43.938Z → 2026-09-25T11:33:06.245Z
- ah 0.1.0 @ ac30c5f · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/4 (0%, 95% CI 0%–49%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/2 |
| mean partial score | 15% |
| harness verdict agrees with grader | 2/4 |
| tasks solved every trial | 0/2 |
| wall time p50 / p95 per trial | 1235.5s / 3305.6s |
| mean TTFT | 1.0s |
| mean prefill / decode | 1613.5 / 106.7 tok/s |
| tokens in / out | 7519666 / 521790 |
| tool error rate | 24% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 944.7s | 52.5 | 12.0 | 113.7 | grader×2 |
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 2216.1s | 105.0 | 25.5 | 99.6 | timeout×1 grader×1 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 12: AssertionError: makespan inf, optimum 19
FAIL case 14: AssertionError: makespan inf, optimum 48
FAIL case 15: AssertionError: makespan inf, optimum 14
FAIL case 16: AssertionError: makespan inf, optimum 41
FAIL case 17: AssertionError: makespan inf, optimum 10
FAIL case 19: AssertionError: makespan inf, optimum 17
FAIL case 20: AssertionError: makespan inf, optimum 17
FAIL case 21: AssertionError: makespan inf, optimum 17
FAIL case 22: AssertionError: makespan inf, optimum 56
FAIL case 23: AssertionError: makespan inf, optimum 33
FAIL case 24: AssertionError: makespan inf, optimum 12
AH_SCORE 8 29
```

### py-optimal-scheduler #2 — grader

```
FAIL case 14: AssertionError: makespan inf, optimum 48
FAIL case 15: AssertionError: makespan inf, optimum 14
FAIL case 16: AssertionError: makespan inf, optimum 41
FAIL case 17: AssertionError: makespan inf, optimum 10
FAIL case 18: AssertionError: makespan inf, optimum 16
FAIL case 19: AssertionError: makespan inf, optimum 17
FAIL case 20: AssertionError: makespan inf, optimum 17
FAIL case 21: AssertionError: makespan inf, optimum 17
FAIL case 22: AssertionError: makespan inf, optimum 56
FAIL case 23: AssertionError: makespan inf, optimum 33
FAIL case 24: AssertionError: makespan inf, optimum 12
AH_SCORE 5 29
```

### ts-sql-engine #1 — timeout: aborted

```
(no grader output)
```

### ts-sql-engine #2 — grader

```
FAIL import: src/db.ts does not export class Database
AH_SCORE 0 1
```

