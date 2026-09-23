# Security model

`ah` runs a language model that can read and write files and execute commands. The guardrails:

## Tools

- **Workspace confinement**: every path is resolved inside the workspace root; `..`, absolute paths outside it and symlinks that escape it (checked on the real path of the deepest existing ancestor) are rejected.
- **Schema validation**: every tool input is validated before running; invalid calls return an error to the model.
- **Read before write**: `edit_file`/`multi_edit` require a prior read; `write_file` will not overwrite a file that was not read.
- **Permission modes**: `ask` (default for `ah run`/`ah chat`: every write tool asks), `auto` (`--yes`), `read-only` (`--read-only`: write tools are hidden and blocked).
- **Dangerous commands** (`sudo`, `rm -rf /` and similar, `git push --force`, `git reset --hard`, `curl … | sh`, `mkfs`, `dd of=/dev/…`, fork bombs, shutdown) always need explicit approval, even in `auto` mode. Non-interactive runs deny them.
- **Shell**: commands run with a timeout, no stdin, output truncated. On timeout or abort the whole process tree is killed (grandchildren such as `npx` → `node` workers would otherwise keep running and hold the output open).
- **Environment scrubbing**: variables whose names look like credentials (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, `*ACCESS_KEY*`, `*PRIVATE_KEY*`, `*CREDENTIAL*`, `*AUTH*`, `*COOKIE*`, `*SESSION*`) are removed from the environment of model-run commands, so `env` cannot leak API keys. `SSH_AUTH_SOCK` is kept (socket path, not a key).
- **`web_fetch`** refuses loopback, private and link-local addresses (SSRF).
- **Secrets**: the system prompt tells the model never to print or commit credentials; `ah` itself never sends API keys anywhere but their provider.

## Web app (`ah serve`)

- Binds to `127.0.0.1` only.
- Every API request needs a random per-process token that is embedded in the served page; other websites cannot read it (same-origin policy).
- `Host` and `Origin` must be `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS-rebinding attacks.
- Strict Content-Security-Policy (`script-src 'self'`), and all model output is HTML-escaped before rendering.
- The agent in the web app runs in `auto` mode inside the workspace passed to `ah serve`; it cannot choose another directory.

## Benchmarks

Trials run in throwaway copies under the output directory, with `auto` permissions and per-task time limits. Hidden graders are copied in after the agent finishes.

## Telemetry

Local only unless you configure an OTLP endpoint. Prompts (first 4000 characters) and tool inputs (first 8 KB) are stored in the local database; delete `~/.ah/telemetry.sqlite` to clear them, or set `AH_TELEMETRY=0`.
