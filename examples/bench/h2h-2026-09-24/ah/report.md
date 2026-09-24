# Benchmark: `llamacpp/DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored-NM-DAU-NEO-MTP-GGUF:Q6_K`

- Run: `bench_2026-09-24T10-36-55_llamacpp_DavidAU_Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Unce` · 2026-09-24T10:36:55.625Z → 2026-09-24T11:03:47.734Z
- ah 0.1.0 @ edb103c · 1 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":1,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card DavidAU/Qwen3.8-27B-TWIN-TURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 8/8 (100%, 95% CI 68%–100%) |
| mean pass@1 | 100% |
| mean pass@1 | 100% |
| mean pass^1 (all trials pass) | 100% |
| tasks solved at least once | 8/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 8/8 |
| tasks solved every trial | 8/8 |
| wall time p50 / p95 per trial | 192.3s / 301.8s |
| mean TTFT | 25.1s |
| mean prefill / decode | 172.3 / 14.7 tok/s |
| tokens in / out | 179997 / 12366 |
| tool error rate | 18% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^1 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 1/1 | 100% | 100% | 21%–100% | 120.9s | 6.0 | 1.0 | 14.7 | - |
| go-feature-stack | go | 2 | 1/1 | 100% | 100% | 21%–100% | 173.7s | 4.0 | 0.0 | 15.0 | - |
| py-bugfix-duration | python | 2 | 1/1 | 100% | 100% | 21%–100% | 172.6s | 8.0 | 1.0 | 13.7 | - |
| rust-fix-compile-and-logic | rust | 3 | 1/1 | 100% | 100% | 21%–100% | 74.4s | 5.0 | 1.0 | 14.3 | - |
| ts-debug-cross-file | typescript | 3 | 1/1 | 100% | 100% | 21%–100% | 210.9s | 5.0 | 1.0 | 14.6 | - |
| ts-feature-lru | typescript | 3 | 1/1 | 100% | 100% | 21%–100% | 314.7s | 6.0 | 0.0 | 14.3 | - |
| ts-multifile-rename | typescript | 3 | 1/1 | 100% | 100% | 21%–100% | 265.0s | 6.0 | 7.0 | 15.9 | - |
| ts-write-tests | typescript | 4 | 1/1 | 100% | 100% | 21%–100% | 277.9s | 7.0 | 1.0 | 15.1 | - |
