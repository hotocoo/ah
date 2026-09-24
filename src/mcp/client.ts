import type { Subprocess } from "bun";
import type { ImageBlock, JsonSchema } from "../core/types.ts";
import { truncate, type Tool, type ToolOutput } from "../tools/types.ts";

// Model Context Protocol client, hand-rolled like the OTLP exporter (D11, D16): MCP is
// JSON-RPC 2.0 over stdio (newline-delimited) or Streamable HTTP, and ah needs only
// initialize, tools/list and tools/call. Claude Desktop / Claude Code config shape.
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export const MCP_PROTOCOL_VERSION = "2025-11-25";
const VERSION = "0.2.0";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: Timer };

export class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

// One connection to one server. Transport differences stay inside send().
export class McpClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private proc?: Subprocess<"pipe", "pipe", "pipe">;
  private sessionId?: string;
  private stderrTail = "";
  tools: McpToolDef[] = [];
  serverInfo?: { name?: string; version?: string };
  instructions?: string;

  constructor(readonly name: string, readonly cfg: McpServerConfig) {}

  get transport(): "stdio" | "http" {
    return this.cfg.url ? "http" : "stdio";
  }

  async connect(): Promise<void> {
    if (this.transport === "stdio") this.spawn();
    const init = (await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ah", version: VERSION },
    }).catch((err: McpError) => {
      // Stateless (2026-07-28) servers may not implement initialize; continue without it.
      if (err.code === -32601) return {};
      throw err;
    })) as { serverInfo?: { name?: string; version?: string }; instructions?: string };
    this.serverInfo = init.serverInfo;
    this.instructions = init.instructions;
    await this.notify("notifications/initialized");
    this.tools = [];
    let cursor: string | undefined;
    do {
      const page = (await this.request("tools/list", cursor ? { cursor } : {})) as { tools?: McpToolDef[]; nextCursor?: string };
      this.tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor && this.tools.length < 1000);
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutput> {
    const r = (await this.request("tools/call", { name, arguments: args }, signal)) as {
      content?: { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string } }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    const texts: string[] = [];
    const images: ImageBlock[] = [];
    for (const c of r.content ?? []) {
      if (c.type === "text" && c.text !== undefined) texts.push(c.text);
      else if (c.type === "image" && c.data && c.mimeType) images.push({ type: "image", mediaType: c.mimeType, data: c.data });
      else if (c.type === "resource" && c.resource) texts.push(c.resource.text ?? `[resource ${c.resource.uri ?? ""}]`);
      else if (c.type === "resource_link") texts.push(`[resource link ${JSON.stringify(c)}]`);
    }
    if (!texts.length && r.structuredContent !== undefined) texts.push(JSON.stringify(r.structuredContent, null, 2));
    return { content: truncate(texts.join("\n") || (images.length ? `${images.length} image(s)` : "[no content]")), isError: Boolean(r.isError), images };
  }

  close(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new McpError("connection closed"));
    }
    this.pending.clear();
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
    if (this.transport === "http" && this.sessionId) void fetch(this.cfg.url!, { method: "DELETE", headers: this.headers() }).catch(() => {});
  }

  private spawn() {
    if (!this.cfg.command) throw new McpError(`${this.name}: "command" or "url" is required`);
    this.proc = Bun.spawn([this.cfg.command, ...(this.cfg.args ?? [])], {
      cwd: this.cfg.cwd,
      env: { ...process.env, ...this.cfg.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    void this.readLines(this.proc.stdout, (line) => this.onMessage(line));
    void this.readLines(this.proc.stderr, (line) => void (this.stderrTail = `${this.stderrTail}\n${line}`.slice(-2000)));
    void this.proc.exited.then((code) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new McpError(`${this.name}: server exited (code ${code})${this.stderrTail ? `: ${this.stderrTail.trim().split("\n").at(-1)}` : ""}`));
      }
      this.pending.clear();
    });
  }

  private async readLines(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void) {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    }
  }

  private onMessage(raw: string) {
    let msg: { id?: number | string; method?: string; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // servers sometimes log to stdout; ignore non-JSON lines
    }
    // Server-to-client request: answer ping, decline the rest (ah declares no client capabilities).
    if (msg.method && msg.id !== undefined) {
      const reply = msg.method === "ping" ? { jsonrpc: "2.0", id: msg.id, result: {} } : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not supported by client" } };
      this.write(reply);
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new McpError(`${this.name}: ${msg.error.message}`, msg.error.code));
    else p.resolve(msg.result ?? {});
  }

  private write(msg: unknown) {
    this.proc?.stdin.write(`${JSON.stringify(msg)}\n`);
    void this.proc?.stdin.flush();
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      ...this.cfg.headers,
    };
  }

  private async notify(method: string, params?: unknown) {
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if (this.transport === "stdio") return this.write(msg);
    await fetch(this.cfg.url!, { method: "POST", headers: this.headers(), body: JSON.stringify(msg) }).catch(() => {});
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs = this.cfg.timeoutMs ?? 60_000;
    const msg = { jsonrpc: "2.0", id, method, params: { ...(params as object), _meta: { "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION } } };
    if (this.transport === "http") return this.httpRequest(id, msg, timeoutMs, signal);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`${this.name}: ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      signal?.addEventListener("abort", () => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        this.write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "aborted" } });
        reject(new McpError("aborted"));
      });
      this.write(msg);
    });
  }

  private async httpRequest(id: number, msg: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const s = AbortSignal.timeout(timeoutMs);
    const res = await fetch(this.cfg.url!, { method: "POST", headers: this.headers(), body: JSON.stringify(msg), signal: signal ? AbortSignal.any([s, signal]) : s });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) throw new McpError(`${this.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const type = res.headers.get("content-type") ?? "";
    let reply: { id?: number; result?: unknown; error?: { code: number; message: string } } | undefined;
    if (type.includes("text/event-stream")) {
      // Read SSE events until the response to this request arrives.
      const text = await res.text();
      for (const block of text.split(/\n\n/)) {
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          const m = JSON.parse(data);
          if (m.id === id) reply = m;
        } catch {
          /* skip malformed event */
        }
      }
    } else reply = (await res.json()) as typeof reply;
    if (!reply) throw new McpError(`${this.name}: no response to request ${id}`);
    if (reply.error) throw new McpError(`${this.name}: ${reply.error.message}`, reply.error.code);
    return reply.result ?? {};
  }
}

// Provider tool names allow [a-zA-Z0-9_-]{1,64}.
export const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

export function wrapMcpTools(client: McpClient): Tool[] {
  return client.tools.map((t) => {
    const readOnly = t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint !== true;
    return {
      readOnly,
      optional: true,
      spec: {
        name: mcpToolName(client.name, t.name),
        description: `[MCP ${client.name}] ${(t.description ?? t.annotations?.title ?? t.name).slice(0, 1024)}`,
        inputSchema: t.inputSchema && t.inputSchema.type === "object" ? t.inputSchema : { type: "object", properties: {} },
      },
      summarize: (i) => `${client.name}.${t.name} ${JSON.stringify(i).slice(0, 80)}`,
      run: (input, ctx) => client.callTool(t.name, input, ctx.signal),
    } satisfies Tool;
  });
}

// Connects every configured server once per process; failures are reported, never fatal.
export class McpManager {
  private clients = new Map<string, McpClient>();
  readonly errors = new Map<string, string>();
  private started?: Promise<void>;

  constructor(private servers: Record<string, McpServerConfig>) {
    process.once("exit", () => this.close());
  }

  get configured(): string[] {
    return Object.keys(this.servers).sort();
  }

  start(connectTimeoutMs = 15_000): Promise<void> {
    this.started ??= Promise.all(
      Object.entries(this.servers)
        .filter(([, c]) => c.enabled !== false)
        .map(async ([name, cfg]) => {
          const c = new McpClient(name, cfg);
          try {
            await Promise.race([c.connect(), Bun.sleep(connectTimeoutMs).then(() => Promise.reject(new McpError(`connect timed out after ${connectTimeoutMs} ms`)))]);
            this.clients.set(name, c);
          } catch (err) {
            c.close();
            this.errors.set(name, (err as Error).message);
          }
        }),
    ).then(() => {});
    return this.started;
  }

  async tools(): Promise<Tool[]> {
    await this.start();
    // Sorted so the tool list (and the cached prompt prefix) is stable across sessions.
    return [...this.clients.values()].flatMap(wrapMcpTools).sort((a, b) => a.spec.name.localeCompare(b.spec.name));
  }

  status() {
    return this.configured.map((name) => {
      const c = this.clients.get(name);
      return {
        name,
        transport: this.servers[name]!.url ? "http" : "stdio",
        connected: Boolean(c),
        tools: c?.tools.map((t) => t.name) ?? [],
        server: c?.serverInfo,
        error: this.errors.get(name),
        enabled: this.servers[name]!.enabled !== false,
      };
    });
  }

  close(): void {
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
  }
}
