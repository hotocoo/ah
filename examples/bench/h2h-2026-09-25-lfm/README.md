# Head-to-head, 2026-09-25: ah vs Hermes Agent vs DeepSeek Harness (dsh) on LFM2.5-2.6B

Same model for all three: `DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0` (3.1 GB) on one llama-server (`llama-server -hf <repo>:Q8_0 --jinja -c 65536 -ngl 99`, 4 slots, harnesses run one after another). Apple M4 Max, 64 GB. Core suite, 8 tasks × 3 trials, fresh sandbox per trial, hidden graders. `bash scripts/h2h.sh --trials 3`, run from a frozen worktree at build `85cc190`.

## Core suite

| harness | trials passed (95% Wilson CI) | tasks solved ≥1 | wall time p50 / total | model calls p50 | prompt tokens, total (per call) | failures |
|---|---|---|---|---|---|---|
| dsh 0.1.1-rc.2 | 9/24 (21%–57%) | 4/8 | 55 s / 36 min | 10.5 | not recorded by dsh | grader 15 |
| ah `85cc190` | 8/24 (18%–53%) | 4/8 | 99 s / 50 min | 15 | 1.73M (4,572) | max_turns 12, grader 3, agent_error 1 |
| Hermes Agent 0.21.3 | 7/24 (15%–49%) | 3/8 | 154 s / 93 min | 15.5 | 12.30M (22,660) | grader 15, timeout 2 |

Per-task deltas: [`ah-vs-hermes.md`](ah-vs-hermes.md), [`ah-vs-dsh.md`](ah-vs-dsh.md). Every per-task difference is inside the Wilson intervals.

- **Accuracy: a three-way tie.** The intervals overlap almost entirely. No harness is shown better on this suite at this model size.
- **Cost:** ah sent 7.1× fewer prompt tokens than Hermes in total (5.0× fewer per model call) for one more passed trial.
- **The comparison was tilted against ah.** External harnesses are bound only by each task's time limit. ah was also held to the task's turn cap (15 to 25 turns), and 12 of its 16 failures are `max_turns`. Hermes used up to 69 turns in a trial. Since this run, `scripts/h2h.sh` gives ah the same time-only budget (`--no-turn-limit`).
- **What ah's verdict is worth:** in all 11 trials where ah's evidence verdict said `failed`, the hidden grader also failed. Of the 9 it called `verified`, 6 passed. The other 3 passed their visible tests, then failed hidden ones (`ts-feature-lru` twice, `ts-bugfix-pagination` once). `verified` means "the checks in the workspace passed", not "correct".

### Example: a success claim with no check behind it

Hermes, `ts-bugfix-pagination` trial 1 ([transcript](examples/hermes-ts-bugfix-pagination-1.agent.log), [diff](examples/hermes-ts-bugfix-pagination-1.diff)): the fix to `src/paginate.ts` is correct, and the reply says "The fix is complete and verified". Yet the regression test it added expects `[4, 5]` for page 3 of size 2 over five items; the right answer is `[5]`. It never ran the tests. The grader runs the whole suite, so the trial fails on the agent's own test. ah's evidence gate targets exactly this case: when files changed and no check has passed since, the model is asked to run one, and the verdict comes from the check, not from the reply.

## What the run found in ah (fixed after `85cc190`)

From ah's own telemetry for these 24 trials (215 tool errors):

| slip | errors | fix |
|---|---|---|
| `bash` `timeout_ms` given in seconds (under the 1000 ms minimum) | 66 of 97 bash errors | values under 1000 read as seconds (D39) |
| absolute paths that rebuilt the workspace root wrong (dropped the trial number) | 90 of 118 file-tool errors | the tail that exists inside the root is used; otherwise the error names the root and the relative path tried (D39) |
| `read_file` on a directory | 3 | returns the listing (D39) |
| server closed the connection mid-stream | 1 trial ended `agent_error` | stream read errors are retryable (D38) |
| trial sandboxes at `work/<task>/<n>`: sibling trials visible, the model ran `cargo build` inside trial 1's directory from trial 3 | shared by all harnesses | each trial in a private `$TMPDIR/ah-trial-XXXX/<task-id>` (D40) |

## After the fixes: ah at `ac30c5f`, same conditions

Same model, server, suite and turn caps as the `85cc190` run above (`bash scripts/h2h.sh --only ah --trials 3 --turn-limit`), with D38 to D40 applied. Details: [`ah-head/report.md`](ah-head/report.md), [`ah-before-vs-after.md`](ah-before-vs-after.md).

| ah build | trials passed (95% CI) | tool error rate | verdict agrees with grader | failures |
|---|---|---|---|---|
| `85cc190` | 8/24 (18%–53%) | 42% | 17/22 | max_turns 12, grader 3, agent_error 1 |
| `ac30c5f` | 11/24 (28%–65%) | 27% | 20/22 | max_turns 13 |

- The tool error rate fell by more than a third, and `ts-multifile-rename` went from 0/3 to 2/3. That task's failures had been path-escape loops.
- 11 against 8 is still inside the intervals: it points the right way, but it does not prove an accuracy gain.
- Every remaining failure is the turn cap. Hermes and dsh never had that cap in the table above.

## Horizon suite

`py-optimal-scheduler` (29 hidden checks) and `ts-sql-engine` (61 checks against SQLite), 2 trials each. ah ran at `ac30c5f` with the time-only budget (`--no-turn-limit`), so all three harnesses had the same limits. Details: [`horizon/`](horizon/).

| harness | trials passed | scheduler checks (t1, t2) | SQL engine checks (t1, t2) | wall time total | prompt tokens |
|---|---|---|---|---|---|
| ah `ac30c5f` | 0/4 | 8/29, 5/29 | 0/61 (hit the 60 min limit, then its engine hung the grader), 0/61 | 105 min | 7.52M |
| Hermes Agent | 0/4 | 5/29, 0/29 | 0/61, 0/61 | 44 min | 3.85M |
| dsh | 0/4 | 0/29, 0/29 | 0/61, 0/61 (both ended with `PI_AI_ERROR`) | 13 min | not recorded |

- At 2.6B, nobody solves either task. That is the grounding working: the naive baselines fail these graders too, so the suite does not hand out passes.
- On partial credit, ah earned 13 of 58 scheduler checks, Hermes 5 and dsh 0. With two trials each this is a small signal, not a ranking.
- ah used the budget. It kept working for up to 145 turns: 2.4× Hermes' wall time and about 2× its prompt tokens. On these tasks that bought partial credit on the scheduler and nothing on the SQL engine.
- dsh's SQL-engine trials ended when llama-server's tool-call parser rejected the model's output ([log](horizon/dsh-ts-sql-engine-2.agent.log): "The model produced output that does not match the expected peg-native format"; the message comes from llama.cpp's `libllama-common`). ah never hit this error with this model, but checking showed it would have ended an ah run the same way: three retries, then `agent_error`. Since D41, ah switches the session to its own text tool protocol when the server cannot parse the model's tool calls.

## Caveats

- n = 3 per task on a 2.6B model: the intervals are wide.
- The trial-layout issue (D40) applied equally to all three harnesses in this run. Passed trials were deleted as soon as they were graded, so only earlier failed attempts were visible to later trials.
- Two short checks of the new commands (one `ah run --goal` task, two `/verify` calls) ran against the same server during the ah and dsh phases, so a few trials shared the server with them for a minute or two.
- Tool-error counts are not comparable across harnesses (see the 2026-09-24 head-to-head README).
