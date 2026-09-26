# Benchmark: `external/dsh`

- Run: `bench_2026-09-26T01-36-50_external_dsh` · 2026-09-26T01:36:50.961Z → 2026-09-26T02:48:15.534Z
- ah 0.1.0 @ 9700548 · 5 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 13/40 (33%, 95% CI 20%–48%) |
| mean pass@1 | 33% |
| mean pass@5 | 50% |
| mean pass^5 (all trials pass) | 0% |
| tasks solved at least once | 4/8 |
| mean partial score | 100% |
| tasks solved every trial | 0/8 |
| wall time p50 / p95 per trial | 72.3s / 309.7s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 0 / 0 |
| tool error rate | 33% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^5 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-bugfix-pagination | typescript | 1 | 3/5 | 60% | 0% | 23%–88% | 24.7s | 6.2 | 1.6 | - | grader×2 |
| go-feature-stack | go | 2 | 0/5 | 0% | 0% | 0%–43% | 124.6s | 13.0 | 5.2 | - | grader×5 |
| py-bugfix-duration | python | 2 | 3/5 | 60% | 0% | 23%–88% | 100.9s | 20.2 | 7.2 | - | grader×2 |
| rust-fix-compile-and-logic | rust | 3 | 0/5 | 0% | 0% | 0%–43% | 196.7s | 17.2 | 9.8 | - | grader×5 |
| ts-debug-cross-file | typescript | 3 | 4/5 | 80% | 0% | 38%–96% | 43.7s | 9.2 | 2.8 | - | grader×1 |
| ts-feature-lru | typescript | 3 | 0/5 | 0% | 0% | 0%–43% | 229.0s | 15.4 | 8.2 | - | grader×5 |
| ts-multifile-rename | typescript | 3 | 3/5 | 60% | 0% | 23%–88% | 87.5s | 13.4 | 4.2 | - | grader×2 |
| ts-write-tests | typescript | 4 | 0/5 | 0% | 0% | 0%–43% | 48.4s | 8.0 | 4.0 | - | grader×5 |

## Failed trials

### ts-bugfix-pagination #1 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-ygfsUJ/ts-bugfix-pagination/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [3.00ms]
```

### ts-bugfix-pagination #4 — grader

```

# Unhandled error between tests
-------------------------------
error: Cannot find module '../paginate' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-CYQmnX/ts-bugfix-pagination/src/paginate.test.ts'
-------------------------------


 4 pass
 1 fail
 1 error
 4 expect() calls
Ran 5 tests across 2 files. [3.00ms]
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
./stack.go:4:2: "errors" imported and not used
./stack.go:12:24: undefined: T
./stack.go:13:10: cannot use generic type Stack[T any] without instantiation
./stack.go:13:30: undefined: T
./stack.go:24:10: cannot use zeroValueOfT(s) (value of type *Stack[T]) as T value in return statement
./stack.go:33:10: cannot use zeroValueOfT(s) (value of type *Stack[T]) as T value in return statement
```

### go-feature-stack #3 — grader

```
FAIL	example.com/stack [setup failed]
FAIL

# example.com/stack
stack_test.go:67:22: expected ']', found '}'
```

### go-feature-stack #4 — grader

```
# example.com/stack [example.com/stack.test]
./stack.go:6:10: undefined: Stack
./stack.go:12:10: undefined: Stack
./stack.go:14:16: cannot use reflect.Zero(T) (value of struct type reflect.Value) as T value in return statement
./stack.go:14:29: T (type) is not an expression
./stack.go:23:10: undefined: Stack
./stack.go:25:16: cannot use reflect.Zero(T) (value of struct type reflect.Value) as T value in return statement
./stack.go:25:29: T (type) is not an expression
./stack.go:31:10: undefined: Stack
./stack.go:36:10: undefined: Stack
./stack_hidden_test.go:6:8: undefined: Stack
./stack_hidden_test.go:6:8: too many errors
```

### go-feature-stack #5 — grader

```
FAIL	example.com/stack [build failed]
FAIL

# example.com/stack [example.com/stack.test]
./stack.go:17:26: syntax error: unexpected name any, expected ]
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

### py-bugfix-duration #5 — grader

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

### rust-fix-compile-and-logic #4 — grader

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

### rust-fix-compile-and-logic #5 — grader

```
error: failed searching for potential workspace
package manifest: `/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-5aRe3G/rust-fix-compile-and-logic/Cargo.toml`
invalid potential workspace manifest: `/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-5aRe3G/Cargo.toml`

help: to avoid searching for a non-existent workspace, add `[workspace]` to the package manifest

Caused by:
  failed to parse manifest at `/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-5aRe3G/Cargo.toml`

Caused by:
  no targets specified in the manifest
  either src/lib.rs, src/main.rs, a [lib] section, or [[bin]] section must be present
```

### ts-debug-cross-file #2 — grader

```
error: expect(received).toBe(expected)

Expected: 2164
Received: 2163

      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-0tmy7y/ts-debug-cross-file/tests/checkout.test.ts:7:61)
(fail) rounds tax half-up [0.28ms]

 0 pass
 1 fail
 1 expect() calls
Ran 1 test across 1 file. [3.00ms]
```

### ts-feature-lru #1 — grader

```
hidden/lru.hidden.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../src/lru.ts' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-1RRiLK/ts-feature-lru/hidden/lru.hidden.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-feature-lru #2 — grader

```
hidden/lru.hidden.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../src/lru.ts' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-6NYGNi/ts-feature-lru/hidden/lru.hidden.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-feature-lru #3 — grader

```
Builtins: "bun:test" 

Elapsed: 3ms | User: 3ms | Sys: 3ms
RSS: 15.20 MB | Peak: 15.20 MB | Commit: 44.91 MB | Faults: 44 | Machine: 0.1 TB

panic(main thread): Segmentation fault at address 0x5
oh no: Bun has crashed. This indicates a bug in Bun, not your code.

To send a redacted crash report to Bun's team,
please file a GitHub issue using the link below:

 https://bun.report/1.4.0/Mt134cbb9aAggggCmzmsWu217vB+tx2rBmu44vB21+yoBm+/7sB24t2H+ni2Hu+g2Hm9/1Hum40H+xgDuqxB+mlB__A2AK
```

### ts-feature-lru #4 — grader

```
70 |       // Update value and move to head
71 |       existingNode.value = value;
           ^
TypeError: undefined is not an object (evaluating 'existingNode.value = value')
      at set (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-EwdW85/ts-feature-lru/src/lru.ts:71:7)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-EwdW85/ts-feature-lru/src/lru.test.ts:55:11)
(fail) LRUCache > keys returns keys from least to most recently used [0.03ms]

 1 pass
 12 fail
 5 expect() calls
Ran 13 tests across 2 files. [4.00ms]
```

### ts-feature-lru #5 — grader

```
hidden/lru.hidden.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../src/lru.ts' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-N66GH0/ts-feature-lru/hidden/lru.hidden.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-multifile-rename #1 — grader

```
                                              ^
ReferenceError: getUserName is not defined
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-lEj7zZ/ts-multifile-rename/src/report.ts:4:43)
      at map (1:11)
      at report (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-lEj7zZ/ts-multifile-rename/src/report.ts:4:16)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-lEj7zZ/ts-multifile-rename/tests/user.test.ts:8:29)
(fail) report [0.17ms]

 2 pass
 1 fail
 2 expect() calls
Ran 3 tests across 1 file. [3.00ms]
```

### ts-multifile-rename #2 — grader

```
                                              ^
ReferenceError: getUserName is not defined
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rXO3J4/ts-multifile-rename/src/report.ts:4:43)
      at map (1:11)
      at report (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rXO3J4/ts-multifile-rename/src/report.ts:4:16)
      at <anonymous> (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-rXO3J4/ts-multifile-rename/tests/user.test.ts:8:29)
(fail) report [0.10ms]

 1 pass
 2 fail
 1 expect() calls
Ran 3 tests across 1 file. [3.00ms]
```

### ts-write-tests #1 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-IgJy3T/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #2 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-B7pbbW/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [2.00ms]
```

### ts-write-tests #3 — grader

```
8 |   if (!passed) throw new Error(`Test failed: "${input}" expected "${expected}" but got "${result}"`);
                             ^
error: Test failed: "simple word" expected "simple" but got "simple-word"
      at runTest (/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-nYKZAB/ts-write-tests/src/slugify.test.ts:8:26)
      at /private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-nYKZAB/ts-write-tests/src/slugify.test.ts:12:1
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #4 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-b8ix6Q/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

### ts-write-tests #5 — grader

```
src/slugify.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module '../slugify' from '/private/var/folders/kl/flgfc94j1pd6d6pm3w6r_mrm0000gn/T/ah-trial-f4zr7e/ts-write-tests/src/slugify.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [3.00ms]
```

