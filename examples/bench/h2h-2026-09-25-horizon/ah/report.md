# Benchmark: `llamacpp/DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored-NM-DAU-NEO-MTP-GGUF:Q6_K`

- Run: `bench_2026-09-24T16-16-10_llamacpp_DavidAU_Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Unce` · 2026-09-24T16:16:10.005Z → 2026-09-24T16:45:48.268Z
- ah 0.1.0 @ a61ede8 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":1,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 1/2 (50%, 95% CI 9%–91%) |
| mean pass@1 | 50% |
| mean pass@2 | 100% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 1/1 |
| mean partial score | 98% |
| harness verdict agrees with grader | 1/2 |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 884.6s / 1265.7s |
| mean TTFT | 7.7s |
| mean prefill / decode | 166.9 / 15.2 tok/s |
| tokens in / out | 61765 / 25653 |
| tool error rate | 13% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 1/2 | 50% | 0% | 9%–91% | 884.6s | 7.5 | 1.0 | 15.2 | grader×1 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 15: over 5 s
AH_SCORE 28 29
```

