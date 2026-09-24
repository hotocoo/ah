# Head-to-head, horizon suite, 2026-09-25

`py-optimal-scheduler`: provably optimal DAG scheduling with 29 hidden checks (greedy list scheduling scores 22/29) and a 45-minute limit. Same model, Qwen3.8-27B Q6_K on one llama-server; 2 trials per harness, run one after another. ah is at build `a61ede8`.

| harness | passed | hidden checks (trial 1, trial 2) | mean score | wall (s) | model calls | prompt tokens (total) |
|---|---|---|---|---|---|---|
| ah | 1/2 | 28/29, 29/29 | 98.3% | 461, 1308 | 7, 8 | 61.8k |
| Hermes Agent | 1/2 | 29/29, 27/29 | 96.6% | 1571, 505 | 18, 7 | 523.8k |
| dsh | 0/2 | 28/29, 0/29 (hit the 45-min limit) | 48.3% | 809, 2700 | 9, 3 | not recorded |

- ah and Hermes tie on passes (1/2 each). ah has the higher partial score (57/58 against 56/58 checks), and it used 8.5× fewer prompt tokens than Hermes for that result.
- dsh's second trial made 3 model calls in 45 minutes and scored 0.
- Two trials cannot establish an accuracy ranking. This measures cost and failure modes on one long task, not a general accuracy claim.
