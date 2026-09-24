# Configuration

Optional. Precedence: built-in defaults < `~/.ah/config.json` < `<workspace>/.ah/config.json`. Environment variables override where noted.

```jsonc
{
  "defaultModel": "llamacpp/ggml-org/MiMo-V2.6-Distill-Qwen-9B-GGUF",        // AH_MODEL; unset = auto-select a local model
  "imageModel": "comfyui/sd_xl_base_1.0.safetensors", // AH_IMAGE_MODEL; unset = first local backend
  "model3d": "llamacpp/my-model",            // AH_3D_MODEL; unset = the session's model
  "runtimes": { "endpoints": ["http://gpu-box:11434"], "scan": true },  // AH_SCAN=0 disables port scan
  "contextWindow": 65536,                    // AH_CONTEXT; capped by trained max and memory
  "maxTokens": 32000,
  "maxTurns": 60,
  "reasoning": "high",                        // off | low | medium | high | max (mapped per server)
  "permissionMode": "ask",                   // ask | auto | read-only
  "toolProtocol": "auto",                    // auto | native | text (AH_TOOL_PROTOCOL)
  "compactToolsRatio": 6,                    // compact tools when window < ratio x (prompt + tool defs)
  "memory": { "fraction": 0.75, "minContext": 16384, "kvBytesPerElement": 2 },
  "contextBudgetRatio": 0.8,                 // compact history above this share of the window
  "bashTimeoutMs": 120000,
  "image": { "width": 1024, "height": 1024, "steps": 20, "cfg": 7, "sampler": "euler", "scheduler": "normal", "negative": "blurry, low quality" },
  "telemetry": { "enabled": true, "otlpEndpoint": "http://localhost:4318" },  // AH_TELEMETRY=0; OTEL_EXPORTER_OTLP_ENDPOINT
  "hardwareSampling": { "enabled": true, "intervalMs": 1000 },               // AH_HW=0
  "providers": {
    "mybox": { "kind": "openai-compatible", "baseURL": "http://10.0.0.5:8000/v1", "apiKeyEnv": "MYBOX_KEY" },
    "anthropic": { "kind": "anthropic", "apiKeyEnv": "ANTHROPIC_API_KEY", "serverFallbacks": true },
    "ollama-12434": { "kind": "ollama", "enabled": false }
  },
  "dataDir": "~/.ah"                          // AH_HOME
}
```

Provider `kind`: `ollama`, `llamacpp`, `lmstudio`, `openai-compatible`, `anthropic`, `gemini`, `mock`. Cloud providers with an API key in the environment are added automatically from models.dev; config entries override or disable them.

Repository instructions: `AGENTS.md`, `CLAUDE.md`, `.ah/instructions.md`, `.cursorrules` and `.github/copilot-instructions.md` in the workspace root are included in the system prompt.

## Memory, evidence, desktop control and extensions

```jsonc
{
  "recall": { "enabled": true, "limit": 5 },  // ~/.ah/memory.sqlite; AH_MEMORY=0 disables
  "evidenceGate": true,                        // ask runs that changed files to pass a check before finishing
  "computerUse": "ask",                        // off | ask | auto (AH_COMPUTER); AH_SCREENSHOT_WIDTH caps screenshot width (1280)
  // Read from ~/.ah/config.json only:
  "mcpServers": {
    "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    "remote": { "url": "https://example.com/mcp", "headers": { "authorization": "Bearer ..." } },
    "github": { "command": "github-mcp", "env": { "GITHUB_TOKEN": "..." } }  // credentials are passed only when named here
  },
  "trustedWorkspaces": ["/Users/me/code/myrepo"],  // `ah trust`; lets that repo's .mcp.json, .ah/plugins, .ah/skills load
  "skillDirs": ["/Users/me/skills"]                // extra agentskills.io folders
}
```

`"mcpTools": "auto" | "inline" | "deferred"` (default `auto`) sets how MCP tools reach the model. `inline` sends every server's schemas with every request. `deferred` sends one `mcp` tool (`{ tool, arguments }`) plus a one-line index of tool names. A call with missing or invalid arguments gets back that tool's input schema, so a model pays for the schemas of the tools it uses and no others. `auto` defers when the MCP schemas are larger than ah's own tool definitions. Measured with context7 + deepwiki + mcp-server-git + @playwright/mcp (42 tools) and the Qwen3.8 tokenizer: 6,329 tokens inline, 1,348 deferred.

**Defaults: auto mode, workspace only.** `permissionMode` defaults to `auto`, so tools run without prompts. Commands matching the dangerous-command list and actions outside the workspace still ask. File tools can never leave the workspace. The shell (`bash`, `run_tests`) runs under an OS sandbox found at runtime (`sandbox-exec` on macOS, `bubblewrap` on Linux). It may read anything but write only to the workspace, temp dirs, `~/Library/Caches`, `~/.cache` and any `writablePaths` you add. `"shellSandbox": "off"` or `AH_SANDBOX=off` removes the confinement. `permissionMode: "ask"` or `ah run` without `--yes` in an ask config brings prompts back. The startup line shows the mode and whether the shell is confined.

**Request arguments.** `params` sets raw request-body fields and is deep-merged last into what ah sends, so any server argument can be set, overridden or removed (`null`) without a code change. It is accepted in four places, later ones winning: `providers.<key>.params`, `models["provider/model"].params`, `presets.<name>.params`, and per call with `--param KEY=VALUE` (repeatable; dotted keys nest; the value is JSON when it parses):

```bash
ah run --param cache_prompt=true --param n_probs=0 --param 'stop=["</done>"]' "..."
ah run --param options.num_gpu=40 -m ollama/<model> "..."       # Ollama options
ah run --param max_tokens=null "..."                             # drop a field ah would send
```

The startup line prints the merged `params`. Protocol adapters (`openai-compatible`, `anthropic`, `gemini`, `ollama`) are code because they are wire formats. Endpoints, ports, models, vendors, sampling and arguments all come from discovery or config. A runtime is labelled with the product name the server reports (plain-text banner or `Server` header), so a server that speaks Ollama's API but is something else shows its real name.

`"presets"` defines named run bundles; nothing is built in. `ah run -p review "..."`, `ah chat --preset review`, or the preset picker in the web console (shown once one exists):

```jsonc
"presets": {
  "review": { "description": "read-only reviewer", "mode": "read-only", "maxTurns": 20, "instructions": "Review only. Report findings with file:line; never edit." },
  "fast":   { "model": "llamacpp/<model id>", "maxTurns": 15 }
}
```

Fields: `model`, `mode` (`ask` / `auto` / `read-only`), `maxTurns`, `instructions` (appended to the system prompt), `features`. Explicit flags win over the preset. The web console always runs in the configured `permissionMode`, so a preset cannot raise the page's permissions.

**Appearance (web app, System tab or ⌘K).** Theme: system, light or dark. Accent: six presets or any custom colour. Its lightness is clamped per theme, so buttons, focus rings, selection and charts keep their contrast. An uploaded wallpaper (PNG, JPEG, WebP, GIF or AVIF; at most 12 MB; the type is checked from magic bytes, not the file name) sits under the UI with adjustable opacity, blur and dim. Settings live in `~/.ah/appearance.json` and the image in `~/.ah/wallpaper.img`. Both routes need the page token; the page shows the image from a `blob:` URL.

Plugins live in `~/.ah/plugins/<name>/plugin.json`: `{ "name", "description", "mcpServers", "instructions": "text or file.md", "tools": "tools.ts", "skills": "skills" }`. A tool module exports `tools: Tool[]` (see `src/tools/types.ts`). Skills are `<dir>/<name>/SKILL.md` with `name` and `description` frontmatter.
