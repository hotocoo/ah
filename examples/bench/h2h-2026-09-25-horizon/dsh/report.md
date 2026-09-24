# Benchmark: `external/dsh`

- Run: `bench_2026-09-24T17-20-53_external_dsh` · 2026-09-24T17:20:53.080Z → 2026-09-24T18:19:30.837Z
- ah 0.1.0 @ a61ede8 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 0/2 (0%, 95% CI 0%–66%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| mean partial score | 48% |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 1754.8s / 2605.5s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 0 / 0 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 1754.8s | 6.0 | 0.0 | - | grader×1 timeout×1 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 15: over 5 s
AH_SCORE 28 29
```

### py-optimal-scheduler #2 — timeout

```
FAIL case 18: NotImplementedError: 
FAIL case 19: NotImplementedError: 
FAIL case 20: NotImplementedError: 
FAIL case 21: NotImplementedError: 
FAIL case 22: NotImplementedError: 
FAIL case 23: NotImplementedError: 
FAIL case 24: NotImplementedError: 
FAIL cycle: NotImplementedError: 
FAIL unknown dep: NotImplementedError: 
FAIL zero workers: NotImplementedError: 
FAIL bad duration: NotImplementedError: 
AH_SCORE 0 29
```

