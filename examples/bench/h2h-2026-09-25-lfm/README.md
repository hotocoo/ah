# Head-to-head, 2026-09-25: ah vs Hermes Agent vs DeepSeek Harness (dsh) on LFM2.5-2.6B

Same model for all three: `DavidAU/LFM2.5-2.6B-Qwen3.8-Turbo-Brilliance-Power-X12-NEO-MAX-GGUF:Q8_0` (3.1 GB) on one llama-server, harnesses run one after another. The server was restarted by the user at 13:39, two minutes into the first ah run. From then on it ran `llama-server -hf <repo>:Q8_0 --ctx-size 131072 --parallel 1 --flash-attn on --jinja --temperature 0.1 --top-k 64 --top-p 0.95 --min-p 0.05 --repeat-penalty 1.1 --reasoning on` (plus cache and batch flags), and every Hermes, dsh and later ah trial ran on it. The first ah trials ran on a 4-slot, 65,536-token server; the restart itself cut one ah trial (`go-feature-stack` #1, "socket connection was closed", `agent_error`). Apple M4 Max, 64 GB. Core suite, 8 tasks × 3 trials, fresh sandbox per trial, hidden graders. `bash scripts/h2h.sh --trials 3`, run from a frozen worktree at build `85cc190`.

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
| server closed the connection mid-stream (the server restart) | 1 trial ended `agent_error` | stream read errors are retryable (D38) |
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

### Same budget as the other harnesses: ah at `0eb3f99`, time limit only

`bash scripts/h2h.sh --only ah --trials 3`: ah is bound only by each task's time limit, the budget Hermes and dsh had in the first table. Details: [`ah-fair/report.md`](ah-fair/report.md).

| harness (same model, tasks and limits) | trials passed (95% CI) | tasks solved ≥1 | wall time total | prompt tokens |
|---|---|---|---|---|
| ah `0eb3f99` | 12/24 (31%–69%) | 5/8 | 113 min | 3.84M |
| dsh | 9/24 (21%–57%) | 4/8 | 36 min | not recorded |
| Hermes Agent | 7/24 (15%–49%) | 3/8 | 93 min | 12.30M |

- ah has the most passes and the most tasks solved, and it used 3.2× fewer prompt tokens than Hermes. The intervals still overlap, so this is the best result, not a proven lead.
- It is also the slowest: ah keeps working until the checks pass or time runs out, while dsh stops early (it finished in a third of the time).
- Two trials ended `agent_error` on invalid tool-call JSON (`go-feature-stack`). That led to D42, which is not in this build.

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

### Horizon rerun with D43 (ah `accffd1`)

Same tasks, budget and server ([`horizon/ah-d43/`](horizon/ah-d43/report.md)). Scheduler checks were 5/29 and 8/29 (13/58, the same total as before), and the SQL engine scored 0/61 twice. The SQL trials worked 30 and 34 minutes, where the earlier finishing trial had stopped after 14.

All four trials ended `verified` while failing the grader. That exposed D44: the model wrote files through shell heredocs, and a heredoc containing the word "test" counted as a passing check. The verdict numbers from this rerun are therefore wrong. D44 fixes the check detection and makes `bash` report the files it writes; it came after this run and is not measured here.

### Latest: ah `8cf94ee` (D38 to D44), time limit only

[`ah-d44/report.md`](ah-d44/report.md): **14/24 (39%–76%), 5/8 tasks**. The verdict agrees with the grader on 21/24 trials, and all 14 passing trials were called `verified`. Against Hermes' 7/24 (15%–49%) the intervals now barely overlap, so it is still not a significant lead at n=3. The prompt tokens (8.12M) are higher than at `0eb3f99`: D43 keeps the model working after a failed check, so more turns are spent on hard tasks. The run found D45 (test filters) and D46 (new files beside the root), which are not in this build.

## Five trials per task: ah `9700548` vs Hermes vs dsh

`bash scripts/h2h.sh --trials 5`: same model, server, tasks and time-only budget for all three, 40 trials each, run one after another. Details: [`t5/`](t5/), per-task deltas in [`t5/ah-vs-hermes.md`](t5/ah-vs-hermes.md) and [`t5/ah-vs-dsh.md`](t5/ah-vs-dsh.md).

| harness | trials passed (95% Wilson CI) | tasks solved ≥1 | pass^5 | wall time total | prompt tokens |
|---|---|---|---|---|---|
| ah `9700548` | **24/40 (45%–74%)** | 6/8 | 38% | 197 min | 14.50M |
| dsh 0.1.1-rc.2 | 13/40 (20%–48%) | 4/8 | 0% | 71 min | not recorded |
| Hermes Agent 0.21.3 | 10/40 (14%–40%) | 4/8 | 0% | 175 min | 20.47M |

- **ah vs Hermes: significant.** The intervals do not overlap (45%–74% against 14%–40%), and `ah bench compare` marks it "better". ah also used 1.4× fewer prompt tokens.
- **ah vs dsh: ahead, but not significant.** The intervals overlap by 3 points (45% against 48%). dsh is 2.8× faster in wall time: it stops early, and ah keeps working until the checks pass or time runs out.
- **Consistency:** ah solved 3 of 8 tasks on every trial (pass^5 38%). Neither Hermes nor dsh solved any task on all 5 trials.
- This build predates D45 to D47.

## Caveats

- n = 3 per task on a 2.6B model: the intervals are wide.
- The trial-layout issue (D40) applied equally to all three harnesses in this run. Passed trials were deleted as soon as they were graded, so only earlier failed attempts were visible to later trials.
- Two short checks of the new commands (one `ah run --goal` task, two `/verify` calls) ran against the same server during the ah and dsh phases, so a few trials shared the server with them for a minute or two.
- Tool-error counts are not comparable across harnesses (see the 2026-09-24 head-to-head README).
