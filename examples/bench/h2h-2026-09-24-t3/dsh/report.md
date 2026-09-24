# Benchmark: `external/dsh`

- Run: `bench_2026-09-24T14-25-06_external_dsh` · 2026-09-24T14:25:06.827Z → 2026-09-24T16:14:57.671Z
- ah 0.1.0 @ 201f200 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 24/24 (100%, 95% CI 86%–100%) |
| mean pass@1 | 100% |
| mean pass@3 | 100% |
| mean pass^3 (all trials pass) | 100% |
| tasks solved at least once | 8/8 |
| mean partial score | 100% |
| tasks solved every trial | 8/8 |
| wall time p50 / p95 per trial | 220.8s / 463.6s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 0 / 0 |
| tool error rate | 1% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 227.8s | 8.3 | 1.0 | - | - |
| go-feature-stack | go | 2 | 3/3 | 100% | 100% | 44%–100% | 210.5s | 6.0 | 0.0 | - | - |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 156.7s | 7.3 | 0.0 | - | - |
| rust-fix-compile-and-logic | rust | 3 | 3/3 | 100% | 100% | 44%–100% | 229.2s | 6.7 | 0.0 | - | - |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 205.3s | 6.3 | 0.0 | - | - |
| ts-feature-lru | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 433.7s | 9.0 | 0.0 | - | - |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 252.7s | 6.7 | 0.0 | - | - |
| ts-write-tests | typescript | 4 | 3/3 | 100% | 100% | 44%–100% | 478.1s | 13.0 | 0.0 | - | - |
