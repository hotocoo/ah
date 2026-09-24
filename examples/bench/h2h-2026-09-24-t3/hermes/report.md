# Benchmark: `external/hermes`

- Run: `bench_2026-09-24T12-22-01_external_hermes` · 2026-09-24T12:22:01.407Z → 2026-09-24T14:24:54.826Z
- ah 0.1.0 @ 0aa8009 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 23/24 (96%, 95% CI 80%–99%) |
| mean pass@1 | 96% |
| mean pass@3 | 100% |
| mean pass^3 (all trials pass) | 88% |
| tasks solved at least once | 8/8 |
| mean partial score | 100% |
| tasks solved every trial | 7/8 |
| wall time p50 / p95 per trial | 246.0s / 581.5s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 2356145 / 41020 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 263.1s | 8.3 | 0.0 | - | - |
| go-feature-stack | go | 2 | 3/3 | 100% | 100% | 44%–100% | 297.9s | 5.0 | 0.0 | - | - |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 183.5s | 6.0 | 0.0 | - | - |
| rust-fix-compile-and-logic | rust | 3 | 3/3 | 100% | 100% | 44%–100% | 223.7s | 5.3 | 0.0 | - | - |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 225.3s | 6.0 | 0.0 | - | - |
| ts-feature-lru | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 536.6s | 7.0 | 0.0 | - | - |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 260.7s | 5.3 | 0.0 | - | - |
| ts-write-tests | typescript | 4 | 2/3 | 67% | 0% | 21%–94% | 463.9s | 7.3 | 0.0 | - | timeout×1 |

## Failed trials

### ts-write-tests #1 — timeout

```
[0m[31merror[0m[2m:[0m [1m[2mexpect([0m[31mreceived[0m[2m).[0mtoBe[2m([0m[32mexpected[0m[2m)[0m

Expected: [0m[32m"你好世界"[0m
Received: [0m[31m""[0m
[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/h2h-2026-09-24-t3/hermes/work/ts-write-tests/1/[0m[36msrc/slugify.test.ts[0m[2m:[0m[33m126[0m[2m:[33m31[0m[2m)[0m
[0m[31m✗[0m [0mslugify[2m > [0municode and international[2m >[0m[1m handles CJK characters[0m [0m[2m[0.29ms[0m[2m][0m

[0m[32m 32 pass[0m
[0m[31m 2 fail[0m
 80 expect() calls
Ran 34 tests across 1 file. [0m[2m[[1m11.00ms[0m[2m][0m
```

