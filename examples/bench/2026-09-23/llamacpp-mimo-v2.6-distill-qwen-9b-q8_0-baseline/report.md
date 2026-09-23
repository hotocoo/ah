# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-23T08-02-17_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF_baseline` · 2026-09-23T08:02:17.544Z → 2026-09-23T09:07:21.080Z
- ah 0.1.0 @ 9c3b418 · 3 trials per task · features: {"contextSizing":false,"textToolParsing":false,"compactTools":false,"toolProtocol":"native","projectFacts":false,"tolerantEdits":false,"recoveries":false}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8091)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 18/24 (75%, 95% CI 55%–88%) |
| mean pass@1 | 75% |
| mean pass@3 | 75% |
| mean pass^3 (all trials pass) | 75% |
| tasks solved at least once | 6/8 |
| tasks solved every trial | 6/8 |
| wall time p50 / p95 per trial | 43.8s / 600.0s |
| mean TTFT | 1.4s |
| mean prefill / decode | 645.3 / 46.5 tok/s |
| tokens in / out | 1208587 / 60090 |
| tool error rate | 12% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 49.1s | 13.7 | 4.0 | 46.7 | - |
| go-feature-stack | go | 2 | 3/3 | 100% | 100% | 44%–100% | 42.0s | 8.7 | 1.3 | 46.5 | - |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 17.3s | 8.0 | 1.3 | 45.6 | - |
| rust-fix-compile-and-logic | rust | 3 | 3/3 | 100% | 100% | 44%–100% | 52.9s | 10.0 | 1.3 | 46.6 | - |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 37.6s | 7.7 | 0.3 | 46.7 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 630.9s | 17.3 | 2.3 | 45.9 | max_turns×2 timeout×1 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 25.7s | 7.0 | 0.3 | 46.7 | - |
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 439.8s | 11.0 | 1.7 | 46.9 | timeout×2 max_turns×1 |

## Failed trials

### ts-feature-lru #1 — max_turns

```

      at /Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-feature-lru/1/src/lru.test.ts:248:12
      at run (node:async_hooks:99:29)
      at node:test:1445:26
      at executeTestNode (node:test:1448:45)
      at node:test:1591:20
(fail) generic usage > works with non-string keys and values [0.09ms]

 22 pass
 8 fail
 8 expect() calls
Ran 30 tests across 2 files. [16.00ms]
```

### ts-feature-lru #2 — max_turns

```
  ]

- Expected  - 3
+ Received  + 4

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-feature-lru/2/src/lru.test.ts:214:22)
(fail) LRUCache > onEvict > is called once per eviction [0.04ms]

 12 pass
 18 fail
 40 expect() calls
Ran 30 tests across 2 files. [3.00ms]
```

### ts-feature-lru #3 — timeout: aborted

```
error: expect(received).toBe(expected)

Expected: 100
Received: 4765

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-feature-lru/3/src/lru.test.ts:249:24)
(fail) edge cases > is efficient for many keys [88.89ms]

 15 pass
 17 fail
 43 expect() calls
Ran 32 tests across 2 files. [12.02s]
```

### ts-write-tests #1 — timeout: aborted

```
TypeError: undefined is not an object (evaluating 's.normalize')
      at slugify (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-write-tests/1/src/slugify.ts:2:10)
      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-write-tests/1/src/slugify.test.ts:184:16)
      at run (node:async_hooks:99:29)
      at <anonymous> (node:test:1445:26)
      at executeTestNode (node:test:1448:45)
      at <anonymous> (node:test:1591:20)
(fail) handles null-ish edge values defensively [0.04ms]

 17 pass
 7 fail
Ran 24 tests across 1 file. [14.00ms]
```

### ts-write-tests #2 — max_turns

```

      at /Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-write-tests/2/src/slugify.test.ts:190:16
      at run (node:async_hooks:99:29)
      at node:test:1445:26
      at executeTestNode (node:test:1448:45)
      at node:test:1591:20
(fail) slugify > output invariants > does not begin or end with a hyphen [1.02ms]

 3 pass
 1 fail
 6 errors
Ran 4 tests across 1 file. [14.00ms]
```

### ts-write-tests #3 — timeout: aborted

```
bun test v1.4.0 (34cbb9a40)

The following filters did not match any test files in --cwd="/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0-baseline/work/ts-write-tests/3":
 src/slugify.test.ts
10 files were searched [2.00ms]

note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename (ex: "MyApp.test.ts")
note: To treat the "src/slugify.test.ts" filter as a path, run "bun test ./src/slugify.test.ts"
```

