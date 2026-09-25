# Benchmark: `llamacpp/DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0`

- Run: `bench_2026-09-25T17-17-53_llamacpp_DavidAU_LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF_Q8_` · 2026-09-25T17:17:53.407Z → 2026-09-25T19:20:37.893Z
- ah 0.1.0 @ 8cf94ee · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8080)
- Generation: {"temperature":0.1,"topK":50,"templateKwargs":{"enable_thinking":true}} (from model card LiquidAI/LFM2.5-2.6B) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 14/24 (58%, 95% CI 39%–76%) |
| mean pass@1 | 58% |
| mean pass@3 | 63% |
| mean pass^3 (all trials pass) | 50% |
| tasks solved at least once | 5/8 |
| mean partial score | 100% |
| harness verdict agrees with grader | 21/24 |
| tasks solved every trial | 4/8 |
| wall time p50 / p95 per trial | 96.5s / 900.0s |
| mean TTFT | 1.1s |
| mean prefill / decode | 1851.0 / 118.0 tok/s |
| tokens in / out | 8120998 / 804904 |
| tool error rate | 28% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/3 | 100% | 100% | 44%–100% | 66.9s | 13.0 | 2.3 | 118.7 | - |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 600.0s | 61.7 | 23.3 | 114.5 | timeout×3 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 49.0s | 9.0 | 0.3 | 121.3 | - |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 818.4s | 62.7 | 17.7 | 114.4 | timeout×2 grader×1 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 43.3s | 10.0 | 1.0 | 120.7 | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 610.2s | 49.3 | 21.0 | 115.3 | timeout×1 grader×2 |
| ts-multifile-rename | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 53.2s | 11.3 | 1.7 | 119.9 | - |
| ts-write-tests | typescript | 4 | 2/3 | 67% | 0% | 21%–94% | 211.9s | 26.7 | 10.3 | 119.2 | grader×1 |

## Failed trials

### go-feature-stack #1 — timeout: aborted

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:6:22: expected ']', found '}'
```

### go-feature-stack #2 — timeout: aborted

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:15:33: T (type) is not an expression
./stack.go:24:33: T (type) is not an expression
./stack.go:37:30: undefined: T
./stack.go:40:14: z.Val undefined (type reflect.Value has no field or method Val)
```

### go-feature-stack #3 — timeout: aborted

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:24:27: T (type) is not an expression
./stack.go:35:27: T (type) is not an expression
```

### rust-fix-compile-and-logic #1 — timeout: aborted

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

### rust-fix-compile-and-logic #2 — grader

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

### rust-fix-compile-and-logic #3 — timeout: aborted

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

### ts-feature-lru #1 — timeout: aborted

```
hidden/lru.hidden.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../src/lru.ts' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-AzNC0l/ts-feature-lru/hidden/lru.hidden.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-feature-lru #2 — grader

```
error: expect(received).toContain(expected)

Expected to contain: "a:"
Received: []

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-PjPWa2/ts-feature-lru/src/lru.test.ts:89:23)
(fail) LRUCache > onEvict is called on eviction [0.04ms]

 6 pass
 10 fail
 24 expect() calls
Ran 16 tests across 2 files. [4.00ms]
```

### ts-feature-lru #3 — grader

```
+ []

- Expected  - 6
+ Received  + 1

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-1cBTgC/ts-feature-lru/hidden/lru.hidden.test.ts:22:14)
(fail) onEvict [0.07ms]

 13 pass
 2 fail
 27 expect() calls
Ran 15 tests across 2 files. [4.00ms]
```

### ts-write-tests #3 — grader

```
40 |     it("handles mixed leading/trailing", () => {
41 |       expect(slugify("!hello!")).toBe("hello");
42 |       expect(slugify("---foo---bar---").toBe("foo-bar"));
                                             ^
TypeError: slugify("---foo---bar---").toBe is not a function. (In 'slugify("---foo---bar---").toBe("foo-bar")', 'slugify("---foo---bar---").toBe' is undefined)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-7ue6FA/ts-write-tests/src/slugify.test.ts:42:41)
(fail) slugify > leading and trailing separators > handles mixed leading/trailing [0.03ms]

 7 pass
 2 fail
 21 expect() calls
Ran 9 tests across 1 file. [3.00ms]
```

