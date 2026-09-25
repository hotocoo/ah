# Benchmark: `external/hermes`

- Run: `bench_2026-09-25T06-27-24_external_hermes` · 2026-09-25T06:27:24.118Z → 2026-09-25T08:00:42.620Z
- ah 0.1.0 @ 85cc190 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 7/24 (29%, 95% CI 15%–49%) |
| mean pass@1 | 29% |
| mean pass@3 | 38% |
| mean pass^3 (all trials pass) | 13% |
| tasks solved at least once | 3/8 |
| mean partial score | 100% |
| tasks solved every trial | 1/8 |
| wall time p50 / p95 per trial | 154.0s / 600.1s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 12304546 / 538898 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 0/3 | 0% | 0% | 0%–56% | 92.3s | 18.3 | 0.0 | - | grader×3 |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 503.3s | 53.0 | 0.0 | - | grader×1 timeout×2 |
| py-bugfix-duration | python | 2 | 2/3 | 67% | 0% | 21%–94% | 177.4s | 21.3 | 0.0 | - | grader×1 |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 229.0s | 14.3 | 0.0 | - | grader×3 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 49.3s | 8.3 | 0.0 | - | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 528.7s | 35.7 | 0.0 | - | grader×3 |
| ts-multifile-rename | typescript | 3 | 2/3 | 67% | 0% | 21%–94% | 140.6s | 13.3 | 0.0 | - | grader×1 |
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 143.2s | 16.7 | 0.0 | - | grader×3 |

## Failed trials

### ts-bugfix-pagination #1 — grader

```
    5,

- Expected  - 1
+ Received  + 0

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-bugfix-pagination/1/src/paginate.test.ts:24:26)
(fail) paginate > should handle edge case where page equals totalPages [0.15ms]

 6 pass
 1 fail
 11 expect() calls
Ran 7 tests across 2 files. [3.00ms]
```

### ts-bugfix-pagination #2 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-bugfix-pagination/2/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [2.00ms]
```

### ts-bugfix-pagination #3 — grader

```
error: expect(received).toBe(expected)

Expected: 1
Received: 2

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-bugfix-pagination/3/src/paginate.test.ts:25:31)
(fail) paginate > should handle edge case where page exceeds total pages [0.12ms]

 6 pass
 1 fail
 13 expect() calls
Ran 7 tests across 2 files. [2.00ms]
```

### go-feature-stack #1 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:18:26: syntax error: unexpected name any, expected ]
```

### go-feature-stack #2 — timeout

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:16:24: undefined: T
./stack.go:17:10: cannot use generic type Stack[T any] without instantiation
./stack.go:17:30: undefined: T
./stack.go:28:10: cannot use nil as T value in return statement
./stack.go:37:10: cannot use nil as T value in return statement
./stack_test.go:36:5: t.Pass undefined (type *testing.T has no field or method Pass)
```

### go-feature-stack #3 — timeout

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:25:24: T (type) is not an expression
./stack.go:27:11: cannot use z.Elem() (value of struct type reflect.Value) as T value in return statement
./stack.go:34:12: cannot convert 0 (untyped int value) to type T: T does not contain specific types
./stack.go:36:1: missing return
./stack.go:41:24: T (type) is not an expression
./stack.go:43:11: cannot use z.Elem() (value of struct type reflect.Value) as T value in return statement
./stack.go:53:12: cannot convert 0 (untyped int value) to type T: T does not contain specific types
./stack.go:55:1: missing return
```

### py-bugfix-duration #2 — grader

```
    def test_values(s, n):
>       assert parse_duration(s) == n
E       AssertionError: assert 3 == 3723
E        +  where 3 = parse_duration('1h2m3s')

test_duration_hidden.py:6: AssertionError
=========================== short test summary info ============================
FAILED test_duration_hidden.py::test_values[1h30m-5400] - AssertionError: assert 1800 == 5400
 +  where 1800 = parse_duration('1h30m')
FAILED test_duration_hidden.py::test_values[1h2m3s-3723] - AssertionError: assert 3 == 3723
 +  where 3 = parse_duration('1h2m3s')
2 failed, 5 passed in 0.01s
```

### rust-fix-compile-and-logic #1 — grader

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
  left: [("b", 2), ("a", 2), ("c", 1)]
 right: [("a", 2), ("b", 2), ("c", 1)]
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    ties_sorted_alphabetically

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--test hidden`
```

### rust-fix-compile-and-logic #3 — grader

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

### ts-feature-lru #1 — grader

```
7 |     cache = new LRUCache(3, onEvict: undefined);
                                                  ^
error: Unexpected )
    at /Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-feature-lru/1/src/lru.test.ts:7:47
-------------------------------


 1 pass
 5 fail
 1 error
 9 expect() calls
Ran 6 tests across 2 files. [2.00ms]
```

### ts-feature-lru #2 — grader

```
test/lru.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './src/lru' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-feature-lru/2/test/lru.test.ts'
-------------------------------


 0 pass
 6 fail
 1 error
Ran 6 tests across 2 files. [3.00ms]
```

### ts-feature-lru #3 — grader

```
error: expect(received).toBe(expected)

Expected: 3
Received: 4

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-feature-lru/3/src/lru.test.ts:50:26)
(fail) LRUCache > evicts least recently used entry when over capacity [0.04ms]

 9 pass
 6 fail
 29 expect() calls
Ran 15 tests across 2 files. [4.00ms]
```

### ts-multifile-rename #3 — grader

```
tests/user.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'getUserName' not found in module '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-multifile-rename/3/src/user.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-write-tests #1 — grader

```
  Input: "mixedCamelCase"
  Expected: "mixed-camel-case"
  Got:      "mixedcamelcase"
      at assertSlug (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-write-tests/1/src/slugify.test.ts:7:15)
      at /Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-write-tests/1/src/slugify.test.ts:16:1
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #2 — grader

```
8 |   if (!passed) throw new Error(`Test failed: ${description}. Got "${result}", expected "${expected}".`);
                             ^
error: Test failed: Empty input should return empty string. Got "empty-string", expected "".
      at runTest (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-write-tests/2/src/slugify.test.ts:8:26)
      at /Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-write-tests/2/src/slugify.test.ts:12:1
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #3 — grader

```
error: expect(received).toBe(expected)

Expected: "japanese-test"
Received: ""

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/hermes/work/ts-write-tests/3/src/slugify.test.ts:52:31)
(fail) slugify > should handle non-ASCII alphanumeric characters [0.04ms]

 5 pass
 3 fail
 15 expect() calls
Ran 8 tests across 1 file. [3.00ms]
```

