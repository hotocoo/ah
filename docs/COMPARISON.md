# How ah compares to other harnesses

**Short answer: `ah` has not been shown to be better than any other harness.** There is no head-to-head run of `ah` against Claude Code, Codex CLI, OpenCode, Aider, Pi or Qwen Code on the same tasks and model. The only comparison `ah` has measured is against itself with its local-model adaptations switched off (README, "Benchmark results"). This page collects what published, independent measurements say about harnesses, so `ah`'s design can be judged against the evidence, and states what a real comparison would need. Sources were gathered on 2026-09-24.

## What published comparisons show

**The harness moves scores as much as the model does, but no harness wins everywhere.**

- Terminal-Bench ranks harness + model pairs. On 2.1 the same Fable 5 model scores 83.8% in Claude Code and 80.4% in the Terminus 2 reference agent; Opus 4.7 shows a 2.8-point gap, Gemini 3.1 Pro 0.2 points ([Snorkel leaderboard](https://snorkel.ai/leaderboard/terminal-bench-2-1/), [Artificial Analysis](https://artificialanalysis.ai/evaluations/terminalbench-2-1), [Morph summary](https://www.morphllm.com/ai-coding-agent)). On 2.0, Opus 4.6 ranges from 75.3% (Capy) to 79.8% (ForgeCode).
- *Stop Comparing LLM Agents Without Disclosing the Harness* ([arXiv 2605.23950](https://arxiv.org/pdf/2605.23950)): six frontier models span 4.9 points under one standard scaffold, while one model (Opus 4.5) spans 9.5 points across harnesses; HAL reports 34-point cross-scaffold gaps.
- Controlled studies find smaller pass-rate effects and larger cost effects: 0-8 points within a model but up to 40x difference in tokens per solved task across open-source harnesses (Scaffold Effect, summarised in [FutureAGI](https://futureagi.com/blog/coding-agent-harness-benchmark/)); DeepSWE's n=10 pilot found native vendor harnesses no better than mini-swe-agent ([arXiv 2607.07946](https://arxiv.org/pdf/2607.07946)); a matched study of nine harnesses on two models found strong harness × benchmark × model interactions and no universal winner ([survey, arXiv 2606.20683](https://arxiv.org/pdf/2606.20683)).
- One context-management change, shortening older tool results as the window fills, roughly doubles fail-to-pass fractions under a tight window and does almost nothing under a wide one (*Same Model, Different Harness*, [arXiv 2608.26218](https://arxiv.org/pdf/2608.26218)).

**Local models (closest to `ah`'s target).** [harness-bench](https://neuralnoise.com/2026/harness-bench-wip/) (neuralnoise.com, 28 Apr 2026, work in progress) ran 10 Q4 local models on llama.cpp through five harnesses on 16 private, hidden-graded tasks on an M3 Max:

| harness | pass rate (160 cells) | mean agent time |
|---|---|---|
| Pi | 123/160 (76.9%) | 163 s |
| Qwen CLI | 120/160 (75.0%) | 191 s |
| Claude Code | 106/160 (66.2%) | 306 s |
| OpenCode | 102/160 (63.8%) | 271 s |
| Aider | 100/160 (62.5%) | 384 s |

Other local reports: Aider had the highest first-try success in one 12-task RTX 4070 test while Qwen Code's ~19k-token system prompt cost 20-30 s per task ([dev.to](https://dev.to/kenimo49/qwen-code-vs-aider-vs-opencode-i-ran-the-same-12-tasks-through-3-local-cli-agents-on-one-rtx-4070-378i)); Claude Code on llama.cpp needs tuning because it sends concurrent requests that force prompt reprocessing ([llama.cpp Anthropic API](https://huggingface.co/blog/ggml-org/anthropic-messages-api-in-llamacpp)); one reported ~10-point spread for the same Qwen3.8 27B weights across harnesses ([regolo.ai](https://regolo.ai/harness-engineering-for-qwen3-8-27b-a-technical-guide-to-pi-opencode-and-kilo-code/)).

## Why these numbers cannot rank ah

- Different tasks: harness-bench tasks are private; `ah`'s suite is its own. Pass rates on different task sets are not comparable.
- Different models: none of the sources used MiMo-V2.6-Distill-Qwen-9B, the model `ah` was measured with. harness-bench's smallest model was gpt-oss-20b (56.2% across harnesses).
- `ah`'s own numbers (18-20/24 on its core suite, 75-83% pass@1) look similar to the harness-bench range, but that similarity means nothing across different tasks and models.

## Where ah's design lines up with the published evidence

These are design correspondences, not results:

| published finding | ah |
|---|---|
| Large system prompts cost local models 20-30 s per turn (Qwen Code report) | compact tool profile chosen from the measured context window (D20) |
| Context management under tight windows roughly doubles fail-to-pass (arXiv 2608.26218) | explicit, memory-aware context sizing, elision of old tool output, and compaction rebuilt from task + harness evidence (D19, D30) |
| Concurrent requests force llama.cpp prompt reprocessing (Claude Code on llama.cpp) | one request at a time; per-model stable context to avoid reloads |
| Memory and skills written without an outcome gate learn bad behaviour (arXiv 2608.12851, 2608.00017) | lessons admitted only from verified runs; trust updated by outcomes (D25, D26) |
| Tokens per solved task vary 40x across harnesses | telemetry records tokens, TTFT, prefill/decode and energy per turn, so this can be measured for `ah` |

## What a real comparison needs

A fair ranking would run the same model, served the same way, on the same tasks with hidden graders and equal time limits, through each harness. Two routes that do not require installing other harnesses here:

1. **Terminal-Bench 2.1** (public tasks, public leaderboard of harness + model pairs): write an `ah` agent adapter for its runner and submit `ah` + an open model, then compare against published pairs that use the same model.
2. **harness-bench**: its author publishes per-cell CSVs; running `ah` on the same models is possible only if the private tasks are shared.

Until one of these exists, the honest claim is: `ah` is designed around failure modes the literature measures, and its own benchmark results are published with confidence intervals and ablations. It is not proven superior.

## On this machine: ah, Hermes Agent, DeepSeek Harness (2026-09-24)

Measured without running Hermes or dsh as agents (static inspection plus tokenizer counts from the served model, Qwen3.8-27B Q6_K on llama.cpp):

| | ah | Hermes Agent 0.21.3 | dsh 0.1.1-rc.2 |
|---|---|---|---|
| default tool schemas sent per request | 12 tools, 1,017 tokens | 24 tools (`hermes-cli` toolset), 10,179 tokens | not measured |
| 4 common MCP servers (42 tools) | 1,348 tokens (deferred, D34) | lazy `tool_search` / `tool_describe` / `tool_call` exists | not measured |
| per-model cross-session tool-error hints | yes (D37) | no (in-session loop guardrails only) | not found |
| hidden-grader bench built in | yes; also runs other harnesses (`--agent-cmd`) | `evals/` (69 probe scripts, no hidden-grader coding suite found), `batch_runner.py` | no |
| skins / wallpaper / accent | 4 skins, custom accent, uploaded wallpaper (D36) | skins (`display.skin`, `~/.hermes/skins/*.yaml`) | skins, wallpaper, pet |

**Pass rates: none yet.** No same-model, same-task results exist for Hermes or dsh. Run `bash scripts/h2h.sh --trials 3` (see BENCHMARKING.md). Until that finishes, this repository claims no superiority over either harness.

Sources for harness-failure research used in D33/D37: [An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/html/2609.20804v1), [Model or Harness? An Interaction-Centric Taxonomy](https://arxiv.org/pdf/2607.28802), [The Devil Is in the Interface](https://arxiv.org/pdf/2608.11386), [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
