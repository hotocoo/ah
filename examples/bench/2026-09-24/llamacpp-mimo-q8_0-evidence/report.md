# Benchmark: `llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF`

- Run: `bench_2026-09-24T02-14-24_llamacpp_ggml-org_MiMo-V2.6-Distill-Qwen-9B-GGUF` · 2026-09-24T02:14:24.478Z → 2026-09-24T02:53:36.973Z
- ah 0.1.0 @ 6997da1 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.6,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card XiaomiMiMo/MiMo-V2.6-Distill-Qwen-9B) · context 262144 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 18/24 (75%, 95% CI 55%–88%) |
| mean pass@1 | 75% |
| mean pass@3 | 88% |
| mean pass^3 (all trials pass) | 50% |
| tasks solved at least once | 7/8 |
| tasks solved every trial | 4/8 |
| wall time p50 / p95 per trial | 57.8s / 279.4s |
| mean TTFT | 0.9s |
| mean prefill / decode | 610.3 / 40.6 tok/s |
| tokens in / out | 2122634 / 79611 |
| tool error rate | 17% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 53.4s | 11.7 | 4.0 | 37.4 | - |
| go-feature-stack | go | 2 | 2/3 | 67% | 0% | 21%–94% | 65.9s | 10.3 | 1.3 | 37.7 | max_turns×1 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 16.3s | 8.0 | 1.3 | 38.2 | - |
| rust-fix-compile-and-logic | rust | 3 | 2/3 | 67% | 0% | 21%–94% | 158.8s | 14.3 | 1.3 | 39.3 | max_turns×1 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 60.6s | 7.7 | 1.0 | 39.8 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 280.4s | 20.0 | 6.0 | 39.4 | max_turns×3 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 23.0s | 6.7 | 0.0 | 46.8 | - |
| ts-write-tests | typescript | 4 | 2/3 | 67% | 0% | 21%–94% | 124.1s | 14.3 | 3.7 | 46.0 | max_turns×1 |

## Failed trials

### go-feature-stack #1 — max_turns

```
--- FAIL: TestPushPopOrder (0.00s)
    stack_test.go:31: stack reports empty with items
FAIL
FAIL	example.com/stack	0.005s
FAIL
```

### rust-fix-compile-and-logic #2 — max_turns

```
assertion `left == right` failed
  left: [("dog", 1), ("end", 1)]
 right: [("the", 3), ("cat", 2)]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    tests::counts_and_orders

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--lib`
```

### ts-feature-lru #1 — max_turns

```
         [31m[1m^[0m
[0m[31mTypeError[0m[2m:[0m [1mnull is not an object (evaluating 'node.prev')[0m
[0m      [2mat [0m[0m[1m[3mremove[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/1/[0m[36msrc/lru.ts[0m[2m:[0m[33m98[0m[2m:[33m5[0m[2m)[0m
[0m      [2mat [0m[0m[1m[3mevict[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/1/[0m[36msrc/lru.ts[0m[2m:[0m[33m105[0m[2m:[33m10[0m[2m)[0m
[0m      [2mat [0m[0m[1m[3mset[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/1/[0m[36msrc/lru.ts[0m[2m:[0m[33m54[0m[2m:[33m12[0m[2m)[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/1/[0m[36msrc/lru.test.ts[0m[2m:[0m[33m172[0m[2m:[33m11[0m[2m)[0m
[0m[31m✗[0m [0mLRUCache update[2m >[0m[1m replaces the value and promotes the key[0m [0m[2m[0.03ms[0m[2m][0m

[0m[32m 4 pass[0m
[0m[31m 20 fail[0m
 16 expect() calls
Ran 24 tests across 2 files. [0m[2m[[1m4.00ms[0m[2m][0m
```

### ts-feature-lru #2 — max_turns

```
  [0m[2m][0m

[32m- Expected  - 1[0m
[31m+ Received  + 1[0m
[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/2/[0m[36msrc/lru.test.ts[0m[2m:[0m[33m200[0m[2m:[33m24[0m[2m)[0m
[0m[31m✗[0m [0mkeys[2m >[0m[1m returns keys from least to most recently used[0m [0m[2m[0.04ms[0m[2m][0m

[0m[32m 26 pass[0m
[0m[31m 5 fail[0m
 59 expect() calls
Ran 31 tests across 2 files. [0m[2m[[1m3.00ms[0m[2m][0m
```

### ts-feature-lru #3 — max_turns

```
[0m[1m92 |[0m     [0m[35mconst[0m node = [0m[35mnew[0m LRUNode[0m<[0mV>()[0m[2m;[0m
                          [31m[1m^[0m
[0m[31mReferenceError[0m[2m:[0m [1mLRUNode is not defined[0m
[0m      [2mat [0m[0m[1m[3mappend[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/3/[0m[36msrc/lru.ts[0m[2m:[0m[33m92[0m[2m:[33m22[0m[2m)[0m
[0m      [2mat [0m[0m[1m[3mset[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/3/[0m[36msrc/lru.ts[0m[2m:[0m[33m49[0m[2m:[33m23[0m[2m)[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-feature-lru/3/[0m[36msrc/lru.test.ts[0m[2m:[0m[33m248[0m[2m:[33m9[0m[2m)[0m
[0m[31m✗[0m [0mgeneral behavior[2m >[0m[1m keeps working correctly after repeated eviction cycles[0m [0m[2m[0.03ms[0m[2m][0m

[0m[32m 8 pass[0m
[0m[31m 24 fail[0m
 9 expect() calls
Ran 32 tests across 2 files. [0m[2m[[1m3.00ms[0m[2m][0m
```

### ts-write-tests #2 — max_turns

```

Expected: [0m[32m"a[0m[32m-b-c[0m[32m"[0m
Received: [0m[31m"a[0m[31m1b2c3[0m[31m"[0m
[0m
[0m      [2mat [0m[0m[1m[3mexpectSlug[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-write-tests/2/[0m[36msrc/slugify.test.ts[0m[2m:[0m[33m7[0m[2m:[33m26[0m[2m)[0m
[0m      [2mat [0m[0m[2m<anonymous>[0m[2m ([0m[0m[36m[2m/Users/acotech/workspace/ah/examples/bench/2026-09-24/llamacpp-mimo-q8_0-evidence/work/ts-write-tests/2/[0m[36msrc/slugify.test.ts[0m[2m:[0m[33m124[0m[2m:[33m5[0m[2m)[0m
[0m[31m✗[0m [0mslugify: digits[2m >[0m[1m collapses digit runs into a single dash[0m [0m[2m[0.18ms[0m[2m][0m

[0m[32m 20 pass[0m
[0m[31m 1 fail[0m
 68 expect() calls
Ran 21 tests across 1 file. [0m[2m[[1m3.00ms[0m[2m][0m
```

