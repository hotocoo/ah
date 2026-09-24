import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpClient, McpManager, mcpToolName, wrapMcpTools } from "../src/mcp/client.ts";
import { discoverExtensions, frontmatter, loadPluginTools, skillViewTool } from "../src/plugins/index.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

// A minimal stdio MCP server: initialize, tools/list (paged), tools/call, and one
// server-to-client ping to check the client answers it.
const SERVER = `
const tools = [
  { name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
  { name: "boom", description: "Always fails", inputSchema: { type: "object", properties: {} } },
];
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") { out({ jsonrpc: "2.0", id: 999, method: "ping" }); out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } }); }
    else if (m.method === "tools/list") out({ jsonrpc: "2.0", id: m.id, result: m.params.cursor ? { tools: [tools[1]] } : { tools: [tools[0]], nextCursor: "p2" } });
    else if (m.method === "tools/call") out({ jsonrpc: "2.0", id: m.id, result: m.params.name === "echo" ? { content: [{ type: "text", text: "echo: " + m.params.arguments.text }] } : { content: [{ type: "text", text: "nope" }], isError: true } });
    else if (m.id === 999) console.error("got pong");
    else if (m.id !== undefined) out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
  }
});
`;

describe("mcp client", () => {
  test("stdio: handshake, paged tools/list, calls, errors", async () => {
    const d = tmp("ah-mcp-");
    writeFileSync(join(d, "server.js"), SERVER);
    const c = new McpClient("fake", { command: process.execPath, args: [join(d, "server.js")] });
    await c.connect();
    expect(c.serverInfo?.name).toBe("fake");
    expect(c.tools.map((t) => t.name)).toEqual(["echo", "boom"]);
    const tools = wrapMcpTools(c);
    expect(tools[0]!.spec.name).toBe("mcp__fake__echo");
    expect(tools[0]!.readOnly).toBe(true);
    expect(tools[1]!.readOnly).toBe(false);
    const ctx = { root: d, bashTimeoutMs: 1000, todos: [], readFiles: new Set<string>(), media: {} };
    expect((await tools[0]!.run({ text: "hi" }, ctx)).content).toBe("echo: hi");
    expect((await tools[1]!.run({}, ctx)).isError).toBe(true);
    c.close();
  });

  test("http: JSON and SSE replies, session id carried", async () => {
    let sawSession = false;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.headers.get("mcp-session-id") === "s1") sawSession = true;
        const m = (await req.json()) as { id?: number; method: string };
        if (m.id === undefined) return new Response(null, { status: 202 });
        if (m.method === "initialize") return Response.json({ jsonrpc: "2.0", id: m.id, result: { serverInfo: { name: "h" } } }, { headers: { "mcp-session-id": "s1" } });
        if (m.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "t", inputSchema: { type: "object" } }] } });
        const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "sse ok" }] } })}\n\n`;
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const c = new McpClient("h", { url: `http://127.0.0.1:${server.port}/mcp` });
    await c.connect();
    expect((await c.callTool("t", {})).content).toBe("sse ok");
    expect(sawSession).toBe(true);
    server.stop(true);
  });

  test("stdio servers do not inherit credentials unless configured", async () => {
    const d = tmp("ah-mcp-env-");
    writeFileSync(join(d, "env.js"), SERVER.replace('"echo: " + m.params.arguments.text', "String(process.env.AH_FAKE_API_KEY) + '/' + String(process.env.AH_PASSED)"));
    process.env.AH_FAKE_API_KEY = "leak";
    const c = new McpClient("env", { command: process.execPath, args: [join(d, "env.js")], env: { AH_PASSED: "yes" } });
    await c.connect();
    expect((await c.callTool("echo", { text: "" })).content).toBe("undefined/yes");
    c.close();
    delete process.env.AH_FAKE_API_KEY;
  });

  test("manager reports failures without throwing", async () => {
    const m = new McpManager({ bad: { command: "/nonexistent/binary" }, off: { command: "x", enabled: false } });
    expect(await m.tools()).toEqual([]);
    const st = m.status();
    expect(st.find((s) => s.name === "bad")!.connected).toBe(false);
    expect(st.find((s) => s.name === "bad")!.error).toBeTruthy();
    expect(st.find((s) => s.name === "off")!.enabled).toBe(false);
  });

  test("tool names are provider-safe", () => {
    expect(mcpToolName("my.server", "do thing")).toBe("mcp__my_server__do_thing");
    expect(mcpToolName("s", "x".repeat(100))).toHaveLength(64);
  });
});

describe("plugins and skills", () => {
  test("workspace extensions load only for trusted workspaces", async () => {
    const home = tmp("ah-home-");
    const root = tmp("ah-ws-");
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { ws: { command: "echo" } } }));
    mkdirSync(join(root, ".ah", "skills", "deploy"), { recursive: true });
    writeFileSync(join(root, ".ah", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship it\n---\nSteps...");
    // A user plugin with instructions, a tool module and its own skill.
    const pdir = join(home, "plugins", "hello");
    mkdirSync(join(pdir, "skills", "greet"), { recursive: true });
    writeFileSync(join(pdir, "plugin.json"), JSON.stringify({ name: "hello", instructions: "Be friendly.", tools: "tools.ts", mcpServers: { srv: { url: "http://x" } } }));
    writeFileSync(join(pdir, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: Say hi\n---\nSay hi.");
    writeFileSync(join(pdir, "tools.ts"), `export const tools = [{ readOnly: true, spec: { name: "hello", description: "d", inputSchema: { type: "object" } }, run: async () => ({ content: "hi" }) }];`);
    writeFileSync(join(home, "config.json"), JSON.stringify({ mcpServers: { u: { command: "u" } } }));

    let ext = discoverExtensions(root, home);
    expect(ext.trusted).toBe(false);
    expect(Object.keys(ext.mcpServers).sort()).toEqual(["hello_srv", "u"]);
    expect(ext.skipped).toContain("mcp server ws (.mcp.json)");
    expect(ext.skills.map((s) => s.name)).toEqual(["greet"]);
    expect(ext.instructions[0]).toContain("Be friendly.");
    const tools = await loadPluginTools(ext);
    expect(tools.map((t) => t.spec.name)).toEqual(["hello"]);

    writeFileSync(join(home, "config.json"), JSON.stringify({ trustedWorkspaces: [root] }));
    ext = discoverExtensions(root, home);
    expect(ext.trusted).toBe(true);
    expect(Object.keys(ext.mcpServers)).toContain("ws");
    expect(ext.skills.map((s) => s.name).sort()).toEqual(["deploy", "greet"]);
    const view = skillViewTool(ext.skills);
    expect((await view.run({ name: "deploy" }, {} as never)).content).toContain("Steps...");
  });

  test("frontmatter parsing", () => {
    expect(frontmatter('---\nname: "x"\ndescription: does y\n---\nbody')).toEqual({ name: "x", description: "does y" });
    expect(frontmatter("no fm")).toEqual({});
  });
});
