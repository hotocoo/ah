# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-24T02-57-14_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF` · 2026-09-24T02:57:14.192Z → 2026-09-24T03:14:19.410Z
- ah 0.1.0 @ 32aabd4 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/3 (0%, 95% CI 0%–56%) |
| mean pass@1 | 0% |
| mean pass@3 | 0% |
| mean pass^3 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| harness verdict agrees with grader | 3/3 |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 262.3s / 510.8s |
| mean TTFT | 1.9s |
| mean prefill / decode | 619.7 / 45.5 tok/s |
| tokens in / out | 522217 / 23372 |
| tool error rate | 31% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 321.3s | 20.0 | 7.3 | 45.5 | max_turns×3 |

## Failed trials

### ts-feature-lru #1 — max_turns

```
[0m[1mbun test [0m[2mv1.4.0 (34cbb9a40)[0m
```

### ts-feature-lru #2 — max_turns

```
  [0m[2m][0m

[32m- Expected  - 1[0m
[31m+ Received  + 1[0m
[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/lru-episodic-reset/work/ts-feature-lru/2/[0m[36msrc/lru.test.ts[0m[2m:[0m[33m185[0m[2m:[33m26[0m[2m)[0m
[0m[31m✗[0m [0mLRUCache[2m >[0m[1m works with non-string keys and arbitrary values[0m [0m[2m[0.04ms[0m[2m][0m

[0m[32m 6 pass[0m
[0m[31m 17 fail[0m
 34 expect() calls
Ran 23 tests across 2 files. [0m[2m[[1m3.00ms[0m[2m][0m
```

### ts-feature-lru #3 — max_turns

```
[0m[31merror[0m[2m:[0m [1m[2mexpect([0m[31mreceived[0m[2m).[0mtoBe[2m([0m[32mexpected[0m[2m)[0m

Expected: [32m2[0m
Received: [31m3[0m
[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/lru-episodic-reset/work/ts-feature-lru/3/[0m[36msrc/lru.test.ts[0m[2m:[0m[33m184[0m[2m:[33m24[0m[2m)[0m
[0m[31m✗[0m [0mintegration[2m >[0m[1m evicts the least recently used across updates[0m [0m[2m[0.03ms[0m[2m][0m

[0m[32m 10 pass[0m
[0m[31m 15 fail[0m
 41 expect() calls
Ran 25 tests across 2 files. [0m[2m[[1m3.00ms[0m[2m][0m
```

