# Long horizon, 2026-09-26: ah vs Hermes Agent on Qwen3.8-27B, `ts-sql-engine`

Build an in-memory SQL engine from a spec, starting from a stub. The hidden grader runs 61 checks and compares every result, column name and change count with SQLite, including 5,000-row tables. Limit: 60 minutes per trial, time only, for both harnesses. 2 trials each.

Model: `DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF:Q6_K` on one llama-server (`--ctx-size 131072 --parallel 1 --flash-attn on --jinja`), Apple M4 Max. ah at `71b5137`. Hermes Agent 0.21.3, isolated `HERMES_HOME` pointed at the same server (`scripts/h2h.sh`).

| harness | hidden checks passed (trial 1, trial 2) | mean | model calls | prompt tokens |
|---|---|---|---|---|
| ah `71b5137` | 33/61, 32/61 | **53%** | 20, 69 | 3.32M |
| Hermes Agent 0.21.3 | 0/61, 7/61 | 6% | 16, 25 | 1.94M |

- All four trials hit the 60-minute limit, so these are partial scores; no trial solved the whole engine.
- ah passed 65 of 122 checks and Hermes 7. With two trials each this is not a statistical claim, but the gap is large in both trials.
- On the LFM2.5-2.6B model the same task scored 0/61 for ah, Hermes and dsh, so the task separates harnesses only at this model size.
- dsh was not run: it takes its model from the user's own `~/.dsh` settings, which point at a different server.
- The first attempt to run Hermes failed before any trial: when another llama-server stopped, discovery renamed this server's runtime key and the saved model ref stopped resolving. That was an ah bug, fixed in D48 before this Hermes run.
