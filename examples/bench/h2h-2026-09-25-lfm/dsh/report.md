# Benchmark: `external/dsh`

- Run: `bench_2026-09-25T08-00-48_external_dsh` · 2026-09-25T08:00:48.698Z → 2026-09-25T08:36:36.211Z
- ah 0.1.0 @ 85cc190 · 3 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 9/24 (38%, 95% CI 21%–57%) |
| mean pass@1 | 38% |
| mean pass@3 | 50% |
| mean pass^3 (all trials pass) | 25% |
| tasks solved at least once | 4/8 |
| mean partial score | 100% |
| tasks solved every trial | 2/8 |
| wall time p50 / p95 per trial | 54.6s / 210.5s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 0 / 0 |
| tool error rate | 31% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^3 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 1/3 | 33% | 0% | 6%–79% | 26.6s | 7.7 | 1.0 | - | grader×2 |
| go-feature-stack | go | 2 | 0/3 | 0% | 0% | 0%–56% | 55.9s | 11.7 | 4.7 | - | grader×3 |
| py-bugfix-duration | python | 2 | 3/3 | 100% | 100% | 44%–100% | 92.7s | 13.3 | 5.7 | - | - |
| rust-fix-compile-and-logic | rust | 3 | 0/3 | 0% | 0% | 0%–56% | 178.8s | 13.3 | 7.0 | - | grader×3 |
| ts-debug-cross-file | typescript | 3 | 3/3 | 100% | 100% | 44%–100% | 40.2s | 8.7 | 0.0 | - | - |
| ts-feature-lru | typescript | 3 | 0/3 | 0% | 0% | 0%–56% | 176.2s | 14.3 | 10.3 | - | grader×3 |
| ts-multifile-rename | typescript | 3 | 2/3 | 67% | 0% | 21%–94% | 94.7s | 13.0 | 2.3 | - | grader×1 |
| ts-write-tests | typescript | 4 | 0/3 | 0% | 0% | 0%–56% | 49.5s | 8.7 | 3.7 | - | grader×3 |

## Failed trials

### ts-bugfix-pagination #1 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-bugfix-pagination/1/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [3.00ms]
```

### ts-bugfix-pagination #2 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-bugfix-pagination/2/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [2.00ms]
```

### go-feature-stack #1 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:17:26: syntax error: unexpected name any, expected ]
```

### go-feature-stack #2 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:17:26: syntax error: unexpected name any, expected ]
./stack.go:33:17: syntax error: unexpected = at end of statement
```

### go-feature-stack #3 — grader

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:18:41: expected ';', found ')'
```

### rust-fix-compile-and-logic #1 — grader

```
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect().to_lowercase();
  |                                                                              ^^^^^^^ cannot infer type of the type parameter `B` declared on the method `collect`
  |
help: consider specifying the generic argument
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect::<Vec<_>>().to_lowercase();
  |                                                                                     ++++++++++

For more information about this error, try `rustc --explain E0282`.
error: could not compile `wordfreq` (lib) due to 1 previous error
error: could not compile `wordfreq` (lib test) due to 1 previous error
```

### rust-fix-compile-and-logic #2 — grader

```
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect().to_lowercase();
  |                                                                              ^^^^^^^ cannot infer type of the type parameter `B` declared on the method `collect`
  |
help: consider specifying the generic argument
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect::<Vec<_>>().to_lowercase();
  |                                                                                     ++++++++++

For more information about this error, try `rustc --explain E0282`.
error: could not compile `wordfreq` (lib) due to 1 previous error
error: could not compile `wordfreq` (lib test) due to 1 previous error
```

### rust-fix-compile-and-logic #3 — grader

```
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect().to_lowercase();
  |                                                                              ^^^^^^^ cannot infer type of the type parameter `B` declared on the method `collect`
  |
help: consider specifying the generic argument
  |
8 |         let word: String = raw.chars().filter(|c| !c.is_ascii_punctuation()).collect::<Vec<_>>().to_lowercase();
  |                                                                                     ++++++++++

For more information about this error, try `rustc --explain E0282`.
error: could not compile `wordfreq` (lib) due to 1 previous error
error: could not compile `wordfreq` (lib test) due to 1 previous error
```

### ts-feature-lru #1 — grader

```
11 |   constructor(capacity: number) {
                   ^
ReferenceError: Node is not defined
      at new LRUCache (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-feature-lru/1/src/lru.ts:11:15)
      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-feature-lru/1/src/lru.test.ts:81:21)
(fail) LRUCache > onEvict > can be called during eviction [0.03ms]

 0 pass
 9 fail
 1 error
 1 expect() calls
Ran 9 tests across 2 files. [3.00ms]
```

### ts-feature-lru #2 — grader

```
error: expect(received).toBe(expected)

Expected: false
Received: true

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-feature-lru/2/src/lru.test.ts:82:28)
(fail) LRUCache > evicts least recently used when over capacity [0.03ms]

 4 pass
 11 fail
 15 expect() calls
Ran 15 tests across 2 files. [4.00ms]
```

### ts-feature-lru #3 — grader

```
hidden/lru.hidden.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../src/lru.ts' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-feature-lru/3/hidden/lru.hidden.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-multifile-rename #3 — grader

```
                                              ^
ReferenceError: getDisplayName is not defined
      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-multifile-rename/3/src/report.ts:2:43)
      at map (1:11)
      at report (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-multifile-rename/3/src/report.ts:2:16)
      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-multifile-rename/3/tests/user.test.ts:8:29)
(fail) report [0.18ms]

 2 pass
 1 fail
 2 expect() calls
Ran 3 tests across 1 file. [3.00ms]
```

### ts-write-tests #1 — grader

```
error: expect(received).toBe(expected)

Expected: "test-123"
Received: "test123"

      at <anonymous> (/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-write-tests/1/src/slugify.test.ts:55:32)
(fail) digits > digits are preserved [0.04ms]

 12 pass
 2 fail
 17 expect() calls
Ran 14 tests across 1 file. [2.00ms]
```

### ts-write-tests #2 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-write-tests/2/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-write-tests #3 — grader

```

4 | def test(name: string, input: string, expected: string) {
                                                  ^
error: Unexpected ":"
    at /Users/acotech/workspace/ah-bench-85cc190/examples/bench/h2h-lfm-core/dsh/work/ts-write-tests/3/src/slugify.test.ts:4:47
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [1.00ms]
```

