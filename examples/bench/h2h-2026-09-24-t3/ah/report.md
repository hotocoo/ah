# Benchmark: `llamacpp/DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored-NM-DAU-NEO-MTP-GGUF:Q6_K`

- Run: `bench_2026-09-24T11-07-34_llamacpp_DavidAU_Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Unce` · 2026-09-24T11:07:34.479Z → 2026-09-24T12:00:29.219Z
- ah 0.1.0 @ 9cc56a1 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":1,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 24/24 (100%, 95% CI 86%–100%) |
| mean pass@1 | 100% |
| mean pass@3 | 100% |
| mean pass^3 (all trials pass) | 100% |
| tasks solved at least once | 8/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 23/24 |
| tasks solved every trial | 8/8 |
| wall time p50 / p95 per trial | 111.5s / 320.0s |
| mean TTFT | 5.5s |
| mean prefill / decode | 177.1 / 15.6 tok/s |
| tokens in / out | 741752 / 42773 |
| tool error rate | 17% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 83.8s | 7.0 | 1.3 | 15.5 | - |
| go-feature-stack | go | 2 | 3/3 | 100% | 100% | 44%–100% | 142.9s | 6.0 | 0.0 | 16.7 | - |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 71.8s | 7.3 | 1.0 | 15.3 | - |
| rust-fix-compile-and-logic | rust | 3 | 3/3 | 100% | 100% | 44%–100% | 69.9s | 6.0 | 0.7 | 15.0 | - |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 54.3s | 5.0 | 0.7 | 15.7 | - |
| ts-feature-lru | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 276.4s | 13.3 | 2.0 | 15.8 | - |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 162.5s | 6.7 | 6.3 | 16.5 | - |
| ts-write-tests | typescript | 4 | 3/3 | 100% | 100% | 44%–100% | 194.7s | 7.0 | 1.0 | 14.7 | - |
