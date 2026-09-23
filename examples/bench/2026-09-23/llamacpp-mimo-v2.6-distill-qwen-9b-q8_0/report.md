# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-23T07-15-04_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF` · 2026-09-23T07:15:04.762Z → 2026-09-23T07:56:44.094Z
- ah 0.1.0 @ 89c2883 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8091)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 20/24 (83%, 95% CI 64%–93%) |
| mean pass@1 | 83% |
| mean pass@3 | 88% |
| mean pass^3 (all trials pass) | 75% |
| tasks solved at least once | 7/8 |
| tasks solved every trial | 6/8 |
| wall time p50 / p95 per trial | 43.9s / 452.8s |
| mean TTFT | 1.5s |
| mean prefill / decode | 627.1 / 45.0 tok/s |
| tokens in / out | 1263796 / 84942 |
| tool error rate | 21% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 22.4s | 7.0 | 1.3 | 44.2 | - |
| go-feature-stack | go | 2 | 2/3 | 67% | 0% | 21%–94% | 66.0s | 13.0 | 4.0 | 44.0 | max_turns×1 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 19.5s | 8.7 | 2.0 | 44.9 | - |
| rust-fix-compile-and-logic | rust | 3 | 3/3 | 100% | 100% | 44%–100% | 80.7s | 11.3 | 2.7 | 44.7 | - |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 34.2s | 9.0 | 1.0 | 44.2 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 488.4s | 20.0 | 8.7 | 44.4 | max_turns×3 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 17.5s | 5.0 | 0.0 | 46.8 | - |
| ts-write-tests | typescript | 4 | 3/3 | 100% | 100% | 44%–100% | 81.0s | 12.7 | 4.3 | 46.6 | - |

## Failed trials

### go-feature-stack #1 — max_turns

```
--- FAIL: TestHiddenStack (0.00s)
    stack_hidden_test.go:11: pop order
--- FAIL: TestPushPop (0.00s)
    stack_test.go:17: Pop = 2, true, want 3, true
--- FAIL: TestPeek (0.00s)
    stack_test.go:58: Pop = 1, true, want 2, true
FAIL
FAIL	example.com/stack	0.007s
FAIL
```

### ts-feature-lru #1 — max_turns

```
+ ]

- Expected  - 1
+ Received  + 6

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0/work/ts-feature-lru/1/src/lru.test.ts:162:21)
(fail) has > does not change recency order [0.21ms]

 33 pass
 1 fail
 66 expect() calls
Ran 34 tests across 2 files. [8.00ms]
```

### ts-feature-lru #2 — max_turns

```
bun test v1.4.0 (34cbb9a40)
```

### ts-feature-lru #3 — max_turns

```
error: expect(received).toBe(expected)

Expected: 1022
Received: 0

      at <anonymous> (/Users/acotech/workspace/ah/examples/bench/2026-09-23/llamacpp-mimo-v2.6-distill-qwen-9b-q8_0/work/ts-feature-lru/3/src/lru.test.ts:265:28)
(fail) O(1) average-case operations > keeps evictions correct under a large working set [6.19ms]

 20 pass
 13 fail
 45 expect() calls
Ran 33 tests across 2 files. [17.00ms]
```

