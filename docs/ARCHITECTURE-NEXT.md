# Evidence-gated cognition: the Aletheia loop

`ah` is named for *aletheia*, unconcealment: what is actually the case, as opposed to what is said. This document describes the architecture that name now stands for, why it differs from the agent loops in Claude Code, Codex, Hermes Agent and MemGPT-style systems, what is implemented, and what is not.

## The problem: every current loop trusts the actor's account

In today's agent harnesses the model is both the actor and the witness.

- **Completion** is the model's call. The loop ends when the model stops requesting tools. If it says "fixed, tests pass" without having run them, the run is recorded as completed.
- **Memory** is written by the model, or on a timer. Claude Code's auto memory and `CLAUDE.md` edits, Letta/MemGPT core memory and Hermes Agent's memory store are all curated by the model itself. Hermes writes skills when an iteration counter reaches 10 (default), gated on a non-empty final reply, not on a positive outcome; the paper *Practice Makes Unsafe: Skill Misevolution in Self-Improving LLM Agents* (arXiv 2608.12851) shows how this lets agents learn bad skills.
- **Retrieval** trusts whatever was stored. *Memory Reward Inflation in Self-Improving LLM Agents* (arXiv 2608.00017) measures agent error rising from 0.32 with a clean retrieved set to 0.61 with a fully corrupted one. Surveys (arXiv 2603.07670, 2603.11768) list write-gate validation as the least developed part of agent memory.

The result is a closed loop of self-report: an unverified claim becomes a memory, the memory is recalled as fact, the next claim builds on it. More model capability does not break that loop; it makes the claims more fluent.

## The principle: separate claims from evidence

The harness is the only witness. It sees every tool call and its real result, so it can keep an account of what happened that does not depend on the model's narration. The Aletheia loop is built on that account, the **evidence ledger** (`src/agent/evidence.ts`), and uses it at four points.

```
            ┌──────────── model (actor) ────────────┐
 prompt ──► │ recall ──► act ──► act ──► "done" ... │ ──► final text (a claim)
            └───┬───────────┬────────┬──────┬───────┘
                │           │        │      │
            memory     observe   observe  completion gate
          (relevance    (implicit prediction:   (changed files and
           × trust)      every action is        no passing check?
                │        expected to succeed)    ask once to verify)
                │           │        │      │
                │      ┌────▼────────▼──────▼────┐
                │      │    evidence ledger      │  (harness-observed only)
                │      │ anomalies · checks ·    │
                │      │ dirty files · verdict   │
                │      └────┬───────────────┬────┘
                │           │               │
                │    admission gate    reconsolidation
                │   (lessons only from  (recalled memories
                │    anomalies resolved  gain trust in verified
                │    in verified runs)   runs, lose it in failed ones)
                │           │               │
                └───────────┴──── memory ◄──┘
```

### 1. Prediction error, without asking the model to predict

An agent issues an action because it expects it to succeed, so every action carries an implicit prediction. A failed action (non-zero exit, tool error, a write that leaves a syntax error) is a prediction error, a surprise. Surprises open **anomalies**, keyed by the kind of action (checks form one kind; otherwise the tool). An anomaly closes when the same kind of action later succeeds, and the mutating actions taken while it was open are its candidate explanation. An anomaly that closed on an immediate retry, with no work in between, explains nothing and is dropped.

This borrows the computational idea behind surprise-gated memory in neuroscience-inspired learning (arXiv 2606.31495; EM-LLM, D-Mem) but needs no extra model output: local 4-9B models already struggle with tool schemas, so asking them to emit predictions would cost accuracy. The signal comes from the environment.

### 2. Completion gate

A **check** is a test, build, type check or lint command (the project's detected test command, `run_tests`, or a shell command using generic toolchain vocabulary). The ledger tracks files changed since the last passing check. When the model tries to end a run with changed files and no passing check since, the harness asks once to run one and fix any failure, or to state explicitly why none applies. Whatever happens, the run gets a **verdict** computed from the ledger, not from the final text:

| verdict | meaning |
|---|---|
| `verified` | the run completed, and every change was followed by a passing check (or it changed nothing and a check passed) |
| `failed` | the run did not complete, or its last check after a change failed |
| `unverified` | completed with changes, no check ever ran on them |
| `none` | nothing changed, nothing checked (e.g. a question) |

The verdict is shown in the CLI (`■ completed (verified)`), the web console and telemetry. A second, cheaper evidence source feeds the same ledger: every write to a JS/TS file is syntax-checked in-process (`Bun.Transpiler`, microseconds) and a broken write is reported in the same tool result.

### 3. Admission gate

Persistent memory (`src/memory/store.ts`, SQLite FTS5) holds three kinds of entry, each with a prior trust:

| kind | written by | prior trust |
|---|---|---|
| `lesson` | the harness: an anomaly that closed inside a run whose verdict is `verified` | 0.8 |
| `note` | the model (`memory_save`) or the user: a claim | 0.5 |
| `episode` | the harness: a compaction summary, faithful but unverified | 0.3 |

Nothing the model says becomes a lesson. A lesson reads like: `` `$ bun run test` failed with "Cannot find module ./evidence". Resolved by: write src/agent/evidence.ts; then `$ bun run test` succeeded. `` Every part of it was observed.

### 4. Reconsolidation

Recall ranks by relevance times trust (`bm25 × trust`). Each memory recalled into a run moves with the run's verdict: toward 1 on `verified` (`trust += (1 - trust) × 0.2`), toward 0 on `failed` (`trust × 0.8`), unchanged on `unverified`. Below a trust floor (0.15) a memory stops being recalled. A poisoned note that keeps preceding failed runs decays out; a lesson that keeps preceding verified runs rises above newer, unproven notes. This is the memory analogue of a reward prediction error, applied per entry, driven only by harness evidence.

Recalled memories ride on the user message, not the system prompt, so the cached prompt prefix stays byte-stable (D4).

## How this compares

| | completion decided by | memory written by | memory write gate | retrieval weighting |
|---|---|---|---|---|
| Claude Code, Codex | model | model (auto memory, instruction files) | none | recency / file inclusion |
| Letta / MemGPT | model | model (self-editing core memory) | none | model-driven paging |
| Hermes Agent | model | model; skills on a 10-iteration timer | non-empty reply | FTS5 relevance; description-routed skills |
| **ah (Aletheia loop)** | model, **gated by harness evidence** | harness (lessons), model (notes, low trust) | **resolved anomaly inside a verified run** | **relevance × outcome-updated trust** |

## Other parts of the same design

- **Desktop control** (`src/tools/computer.ts`, D29): `screenshot` and `computer` (click, drag, scroll, type, key combos, open) through the OS's own facilities, discovered at runtime. The agent sees the screen at up to 1280 px wide and works in screenshot coordinates. Every action needs approval unless the user opts into `computerUse: "auto"`; the web console shows the approval and a live view of the latest screenshot.
- **MCP and plugins** (D27, D28): a hand-rolled MCP client (stdio and Streamable HTTP, 2025-11-25 handshake with 2026-07-28 per-request `_meta` version), plugins with `plugin.json` or Claude Code layout, agentskills.io skills with an index in the prompt and `skill_view` on demand. Anything a workspace ships that can run code loads only for workspaces the user trusted.

## Measured

See the README results table. The evidence loop was measured on the same 8-task suite and model (MiMo-V2.6-Distill-Qwen-9B Q8_0 on llama.cpp) as the 2026-09-23 runs; memory and user extensions are off in benchmarks so trials stay independent.

## Limits (honest)

- The implicit prediction is binary (succeeded or not). It cannot notice an action that succeeded but did the wrong thing; only a later failing check reveals that.
- Check detection uses the detected test command plus generic toolchain words. A project whose only check is an unusual script name needs `run_tests` or a config test command.
- Lesson text is built from tool summaries. It records what was done, not why it worked.
- The completion gate asks once. A model that ignores it still ends the run, but the verdict says `unverified` or `failed` rather than trusting the reply.
- None of this is general intelligence. It removes one failure mode that capability alone does not fix: an agent believing its own account.

## Next

1. **Calibration-aware autonomy.** Track each model's surprise rate per tool from telemetry; surface it before enabling `computerUse: "auto"` for that model.
2. **Evidence-weighted skill distillation.** Promote lessons with high trust and repeated wins into agentskills.io skills, the reverse of timer-driven skill writing.
3. **Counterfactual replay.** Re-run a failed benchmark trial in its sandbox with a recalled lesson injected, to measure whether the lesson causes the fix.
