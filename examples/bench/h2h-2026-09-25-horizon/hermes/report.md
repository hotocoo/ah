# Benchmark: `external/hermes`

- Run: `bench_2026-09-24T16-45-56_external_hermes` · 2026-09-24T16:45:56.173Z → 2026-09-24T17:20:44.946Z
- ah 0.1.0 @ a61ede8 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 1/2 (50%, 95% CI 9%–91%) |
| mean pass@1 | 50% |
| mean pass@2 | 100% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 1/1 |
| mean partial score | 97% |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 1038.4s / 1518.1s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 523785 / 26524 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 1/2 | 50% | 0% | 9%–91% | 1038.4s | 12.5 | 0.0 | - | grader×1 |

## Failed trials

### py-optimal-scheduler #2 — grader

```
FAIL case 15: over 5 s
FAIL case 24: over 5 s
AH_SCORE 27 29
```

