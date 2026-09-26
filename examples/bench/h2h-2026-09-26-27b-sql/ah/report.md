# Benchmark: `llamacpp-8081/DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF:Q6_K`

- Run: `bench_2026-09-26T02-51-30_llamacpp-8081_DavidAU_Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncens` · 2026-09-26T02:51:30.255Z → 2026-09-26T04:51:30.729Z
- ah 0.1.0 @ 71b5137 · 2 trials per task · features: {}
- Hardware: Apple M4 Max · 64 GB · 16 threads
- Runtime: llamacpp b10621-c1d0e7a00 (http://127.0.0.1:8081)
- Generation: {"temperature":1,"topP":0.95,"topK":20,"templateKwargs":{"enable_thinking":true}} (from model card DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NM-DAU) · context 131072 · tools native

## Overall

| metric | value |
|---|---|
| trials passed | 0/2 (0%, 95% CI 0%–66%) |
| mean pass@1 | 0% |
| mean pass@2 | 0% |
| mean pass^2 (all trials pass) | 0% |
| tasks solved at least once | 0/1 |
| mean partial score | 53% |
| harness verdict agrees with grader | 2/2 |
| tasks solved every trial | 0/1 |
| wall time p50 / p95 per trial | 3599.4s / 3599.9s |
| mean TTFT | 7.6s |
| mean prefill / decode | 162.0 / 15.2 tok/s |
| tokens in / out | 3323257 / 89854 |
| tool error rate | 18% |
| tool calls recovered from text | 0 |

## Per task

| task | lang | diff. | pass | pass@1 | pass^2 | 95% CI | mean time | turns | tool err | decode tok/s | failures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-sql-engine | typescript | 5 | 0/2 | 0% | 0% | 0%–66% | 3599.4s | 44.5 | 10.5 | 15.2 | timeout×2 |

## Failed trials

### ts-sql-engine #1 — timeout: aborted

```
FAIL SELECT DISTINCT age FROM users ORDER BY age: rows [[null],[19],[25],[25],[31],[42]] expected [[null],[19],[25],[31],[42]]
FAIL SELECT name, age FROM users ORDER BY 2, 1: rows [["Ann",31],["Bob",null],["Cid",25],["Dee",42],["Eve",25],["fay",19]] expected [["Bob",null],["fay",19],["Cid",25],["Eve",25],["Ann",31],["Dee",42]]
FAIL SELECT name AS n FROM users ORDER BY n DESC LIMIT 2: no such column: n
FAIL SELECT u.name, sum(o.amount) AS total, count(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id ORDER BY total DESC, u.name: rows [["fay",null,0],["Eve",5,2],["Dee",null,0],["Cid",99,1],["Bob",null,0],["Ann",42,2]] expected [["Cid",99,1],["Ann",42,2],["Eve",5,2],["Bob",null,0],["Dee",null,0],["fay",null,0]]
FAIL SELECT o.* FROM orders o WHERE o.amount > 20 ORDER BY o.id: rows [[10,1,30,"book"],[10,1,30,"book"],[10,1,30,"book"]] expected [[10,1,30,"book"],[12,3,99,"lamp"],[15,9,40,"book"]]
FAIL update with where: syntax error: unexpected EQ
FAIL update sets several columns: syntax error: unexpected EQ
FAIL update sees the old row: syntax error: unexpected EQ
FAIL delete with where: null is not an object (evaluating 'expr.kind')
FAIL error: SELECT missing FROM empty_t: did not throw
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: syntax error: unexpected EQ
AH_SCORE 33 61
```

### ts-sql-engine #2 — timeout: aborted

```
FAIL SELECT u.name, o.amount FROM users u LEFT JOIN orders o ON o.user_id = u.id ORDER BY u.id, o.id: syntax error: unexpected token COMMA at position 90
FAIL SELECT u.name, sum(o.amount) AS total, count(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id ORDER BY total DESC, u.name: syntax error: unexpected token COMMA at position 137
FAIL SELECT o.* FROM orders o WHERE o.amount > 20 ORDER BY o.id: syntax error: expected IDENT, got STAR at position 10
FAIL update sets several columns: syntax error: expected IDENT, got COMMA at position 25
FAIL update sees the old row: syntax error: expected IDENT, got COMMA at position 26
FAIL delete everything: rows [] expected [[0]]
FAIL error: SELECT missing FROM empty_t: did not throw
FAIL error: SELECT id FROM users u JOIN orders o ON u.id = o.user_id: did not throw
FAIL scale: SELECT g, count(*), sum(n) FROM nums WHERE n % 3 = 0 GROUP BY g ORDER BY g: no such column: n
FAIL scale: SELECT n, s FROM nums ORDER BY s DESC, n LIMIT 5: syntax error: unexpected token COMMA at position 38
FAIL scale: SELECT label, count(*) FROM nums JOIN groups ON nums.g = groups.g WHERE n > 2500 GROUP BY label ORDER BY label: rows [["g0",2],["g1",2],["g10",2],["g11",2],["g12",2],["g13",2],["g14",2],["g15",2],["g16",2],["g17",2],["g18",2],["g19",2],["g2",2],["g20",2],["g21",2],["g22",2],["g23",2],["g24",2],["g25",2],["g26",2],["g27",2],["g28",2],["g29",2],["g3",2],["g30",2],["g31",2],["g32",2],["g33",2],["g34",2],["g35",2],["g36",2],["g4",2],["g5",2],["g6",2],["g7",2],["g8",2],["g9",2]] expected [["g0",68],["g1",68],["g
AH_SCORE 32 61
```

