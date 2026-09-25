# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T15-51-26_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T15:51:26.051Z → 2026-09-25T17:13:12.552Z
- ah 0.1.0 @ accffd1 · 2 trials per task · features: {}
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
| mean partial score | 11% |
| harness verdict agrees with grader | 0/4 |
| tasks solved every trial | 0/2 |
| wall time p50 / p95 per trial | 1277.1s / 1982.0s |
| mean TTFT | 1.1s |
| mean prefill / decode | 1516.6 / 107.3 tok/s |
| tokens in / out | 8349250 / 474390 |
| tool error rate | 21% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 539.9s | 35.0 | 7.0 | 113.6 | grader×2 |
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 1894.9s | 82.0 | 18.0 | 101.1 | grader×2 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 14: AssertionError: bad slot for t2
FAIL case 15: over 5 s
FAIL case 16: AssertionError: bad slot for t0
FAIL case 17: over 5 s
FAIL case 18: AssertionError: bad slot for t3
FAIL case 19: AssertionError: bad slot for t3
FAIL case 20: over 5 s
FAIL case 21: AssertionError: bad slot for t3
FAIL case 22: AssertionError: bad slot for t2
FAIL case 23: AssertionError: bad slot for t0
FAIL case 24: over 5 s
AH_SCORE 5 29
```

### py-optimal-scheduler #2 — grader

```
FAIL case 12: AssertionError: makespan inf, optimum 19
FAIL case 13: AssertionError: makespan inf, optimum 25
FAIL case 14: AssertionError: makespan inf, optimum 48
FAIL case 15: over 5 s
FAIL case 17: AssertionError: makespan inf, optimum 10
FAIL case 18: AssertionError: makespan 29, optimum 16
FAIL case 19: AssertionError: makespan inf, optimum 17
FAIL case 20: AssertionError: makespan 50, optimum 17
FAIL case 22: AssertionError: makespan inf, optimum 56
FAIL case 23: AssertionError: makespan inf, optimum 33
FAIL case 24: AssertionError: makespan 35, optimum 12
AH_SCORE 8 29
```

### ts-sql-engine #1 — grader

```
FAIL import: 3 errors building "/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-z4rUFz/ts-sql-engine/src/db.ts"
AH_SCORE 0 1
```

### ts-sql-engine #2 — grader

```
FAIL import: 5 errors building "/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-eQP4nX/ts-sql-engine/src/db.ts"
AH_SCORE 0 1
```

