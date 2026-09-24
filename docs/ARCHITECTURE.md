# Architecture

`ah` (Aletheia Harness) is a single Bun/TypeScript application: a CLI, a local web app and a library, sharing one core.

```
                 ┌──────────────── ah CLI ────────────────┐   ┌── ah serve (web app) ──┐
                 │ run · chat · doctor · models · bench   │   │ dashboard · agent chat │
                 │ telemetry · image · 3d                 │   │ runs · bench · models  │
                 └───────────────┬────────────────────────┘   └───────────┬────────────┘
                                 │  src/app/session.ts (Environment, createSession)
        ┌────────────────────────┼─────────────────────────────────────────┐
        │                        │                                         │
 src/runtimes/            src/agent/loop.ts                         src/telemetry/
 discover.ts  ──────►  stream turn → tools → results → …  ──events──► store (SQLite)
 context.ts             retries · compaction · truncation            otlp · jsonl
 hardware.ts            text tool-call recovery · text protocol      metrics
        │                        │                                         ▲
        ▼                        ▼                                         │
 src/providers/          src/tools/ (15 tools, validated,            src/bench/
 anthropic · openai-     confined, permission-gated)                 task · runner · stats
 compatible · gemini ·   read/write/edit/multi_edit/list/glob/grep/  report · throughput
 ollama · mock           repo_map/bash/run_tests/git/todo/web/
        │                image/3d
        ▼                        │
 src/models/catalog.ts           ▼
 models.dev · OpenRouter  src/media/ image backends (ComfyUI, sdapi, provider APIs)
 live runtime listings           procedural 3D (scene → mesh → GLB/glTF/OBJ/STL, preview)
```

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Core types | `src/core/types.ts` | Provider-neutral `Message`, `ContentBlock`, `StreamEvent`, `Usage`, `ModelInfo`, `RuntimeTimings`. |
| Runtimes | `src/runtimes/` | Find local runtimes (port scan + API fingerprints), size context windows from GGUF metadata and memory, sample hardware. |
| Providers | `src/providers/` | Wire protocols. Each adapter streams `StreamEvent`s and ends with exactly one `done`. Wire-format quirks are learned (D5). |
| Models | `src/models/catalog.ts` | Merge models.dev, OpenRouter and live runtime listings; search; resolve `provider/model` refs. |
| Agent | `src/agent/` | The loop (`loop.ts`), system prompt (`prompt.ts`), context compaction (`context.ts`), tool-call recovery and text protocol (`toolcall-parser.ts`), event types (`events.ts`). |
| Tools | `src/tools/` | Coding tools with JSON-Schema validation, path confinement, read-before-edit, permission modes, availability rules. |
| Media | `src/media/` | Image backends and procedural 3D modelling; PNG encoder and software rasteriser. |
| Telemetry | `src/telemetry/` | Event sinks (SQLite, OTLP, JSONL), hardware attribution, pricing, aggregate queries. |
| Bench | `src/bench/` | Task loader, sandboxed trial runner, statistics, reports, throughput benchmark. |
| App | `src/app/session.ts`, `src/cli/`, `src/server/` | Assembly, CLI commands, web app. |

## One agent turn

1. `maybeCompact()` — if the estimated context exceeds `contextBudgetRatio` of the window (or truncation was detected), elide old tool output, else summarise older turns with the model.
2. `callModel()` — build the request (native tools, or text protocol for models without tool support), stream it, measure TTFT at the first delta, collect runtime timings, retry transient errors with backoff, learn wire-format fixes.
3. Recover tool calls written as text (12 formats) when no structured call arrived.
4. Stop rules: refusal → stop; `max_tokens` with tool calls → never run them, retry once with a larger budget; no tool calls → done.
5. Run tools: read-only calls in parallel, writes sequentially; every input validated; errors returned as tool results.
6. Append results and repeat until done, `maxTurns`, budget, timeout or abort.

Every step emits an `AgentEvent`; the CLI renderer, the web app (SSE), SQLite, OTLP and JSONL consume the same stream.

## Data files

Everything lives under `~/.ah` (override with `AH_HOME`): `telemetry.sqlite` (runs, turns, tool calls, events, caches, learned wire formats, context decisions, bench runs), `events/YYYY-MM-DD.jsonl`, `bench/<run>/` results, `config.json`.

## Evidence, memory and extensions (added 2026-09-24)

| Layer | Files | Responsibility |
|---|---|---|
| Evidence | `src/agent/evidence.ts` | Ledger of observed tool outcomes: anomalies (failed actions), checks, files changed since the last passing check; completion gate; run verdict; lesson candidates. See ARCHITECTURE-NEXT.md. |
| Memory | `src/memory/store.ts`, `src/tools/memory.ts` | FTS5 store (`~/.ah/memory.sqlite`) of lessons, notes and episodes; recall by relevance × trust into each request; trust updated by run verdicts. |
| MCP | `src/mcp/client.ts` | stdio / Streamable HTTP client; MCP tools wrapped as `Tool`s. |
| Plugins | `src/plugins/index.ts` | Plugin, skill and MCP server discovery; workspace trust; `skill_view`. |
| Desktop | `src/tools/computer.ts` | `screenshot` / `computer` tools over OS facilities discovered at runtime. |

Per run: `run()` recalls memories into the user message, `runOneTool()` feeds every outcome to the ledger, the loop consults the ledger before accepting a final reply, and `settleMemory()` writes verified lessons and reinforces recalled memories. Extensions load once per workspace in `loadExtensions()` (`src/app/session.ts`) and join the tool registry at session creation, so the system prompt stays byte-stable.
