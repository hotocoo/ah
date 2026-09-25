# Benchmark: `external/hermes`

- Run: `bench_2026-09-25T11-33-12_external_hermes` · 2026-09-25T11:33:12.637Z → 2026-09-25T12:17:59.657Z
- ah 0.1.0 @ ac30c5f · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads

## Overall

| metric | value |
|---|---|
| trials passed | 0/4 (0%, 95% CI 0%–49%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/2 |
| mean partial score | 4% |
| tasks solved every trial | 0/2 |
| wall time p50 / p95 per trial | 661.8s / 894.3s |
| mean TTFT | - |
| mean prefill / decode | - / - tok/s |
| tokens in / out | 3846072 / 225312 |
| tool error rate | 0% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| py-optimal-scheduler | python | 5 | 0/2 | 0% | 0% | 0%–66% | 543.0s | 28.0 | 0.0 | - | grader×2 |
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 786.4s | 35.5 | 0.0 | - | grader×2 |

## Failed trials

### py-optimal-scheduler #1 — grader

```
FAIL case 14: AssertionError: plan must cover every task
FAIL case 15: AssertionError: makespan 42, optimum 14
FAIL case 16: AssertionError: plan must cover every task
FAIL case 17: AssertionError: makespan 28, optimum 10
FAIL case 18: AssertionError: makespan 29, optimum 16
FAIL case 19: AssertionError: makespan 31, optimum 17
FAIL case 20: AssertionError: makespan 50, optimum 17
FAIL case 21: AssertionError: plan must cover every task
FAIL case 22: AssertionError: plan must cover every task
FAIL case 23: AssertionError: plan must cover every task
FAIL case 24: AssertionError: makespan 35, optimum 12
AH_SCORE 5 29
```

### py-optimal-scheduler #2 — grader

```
FAIL case 18: NotImplementedError: 
FAIL case 19: NotImplementedError: 
FAIL case 20: NotImplementedError: 
FAIL case 21: NotImplementedError: 
FAIL case 22: NotImplementedError: 
FAIL case 23: NotImplementedError: 
FAIL case 24: NotImplementedError: 
FAIL cycle: NotImplementedError: 
FAIL unknown dep: NotImplementedError: 
FAIL zero workers: NotImplementedError: 
FAIL bad duration: NotImplementedError: 
AH_SCORE 0 29
```

### ts-sql-engine #1 — grader

```
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
DEBUG: Catch block - error: syntax error in: CREATE TABLE nums ()
FAIL scale: insert 5,000 rows: syntax error in: CREATE TABLE nums (n INTEGER, g INTEGER, s TEXT)
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: setup failed
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: setup failed
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: setup failed
AH_SCORE 0 61
```

### ts-sql-engine #2 — grader

```
FAIL error: SELECT nope FROM users: Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT missing FROM empty_t: Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: CREATE TABLE users (x INTEGER): Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT FROM users: Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT * FROM users WHERE: Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: INSERT INTO users VALUES (1, 'x'): Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL error: SELECT id FROM users u JOIN orders o ON u.id = o.user_id: Error executing: CREATE TABLE users (id INTEGER, name TEXT, age INTEGER, city TEXT)
FAIL scale: insert 5,000 rows: Error executing: INSERT INTO nums VALUES (0, 0, 's0'), (1, 1, 's2919'), (2, 2, 's838'), (3, 3, 's3757'), (4, 4, 's1676'), (5, 5, 's4595'), (6, 6, 's2514'), (7, 7, 's433'), (8, 8, 's3352'), (9, 9, 's1271'), (10, 10, 's4190'), (11, 11, 's2109'), (12, 12, 's28'), (13, 13, 's2947'), (14, 14, 's866'), (15, 15, 's3785'), (16, 16, 's1704'), (17, 17, 's4623'), (18, 18, 's2542'), (19, 19, 's461'), (20, 20,
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: setup failed
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: setup failed
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: setup failed
AH_SCORE 0 61
```

