import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/agent/loop.ts";
import { extractToolCalls, recoverToolCalls, textProtocolInstructions, toTextProtocol } from "../src/agent/toolcall-parser.ts";
import type { ChatRequest, StreamEvent } from "../src/core/types.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { ToolRegistry } from "../src/tools/index.ts";

const names = ["read_file", "edit_file", "bash"];

describe("extractToolCalls", () => {
  const cases: [string, string, { name: string; input: Record<string, unknown> }[]][] = [
    ["hermes tag", 'Let me look.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>', [{ name: "read_file", input: { path: "a.ts" } }]],
    ["string arguments", '<tool_call>{"name":"bash","arguments":"{\\"command\\":\\"ls\\"}"}</tool_call>', [{ name: "bash", input: { command: "ls" } }]],
    [
      "qwen3-coder xml",
      "<tool_call>\n<function=edit_file>\n<parameter=path>\na.ts\n</parameter>\n<parameter=old_string>\na - b\n</parameter>\n<parameter=new_string>\na + b\n</parameter>\n</function>\n</tool_call>",
      [{ name: "edit_file", input: { path: "a.ts", old_string: "a - b", new_string: "a + b" } }],
    ],
    ["invoke xml", '<invoke name="bash"><parameter name="command">bun test</parameter></invoke>', [{ name: "bash", input: { command: "bun test" } }]],
    ["mistral array", '[TOOL_CALLS][{"name": "read_file", "arguments": {"path": "x"}}]', [{ name: "read_file", input: { path: "x" } }]],
    ["mistral args", '[TOOL_CALLS]bash[ARGS]{"command": "pwd"}', [{ name: "bash", input: { command: "pwd" } }]],
    ["llama python tag", '<|python_tag|>{"name": "bash", "parameters": {"command": "ls"}}', [{ name: "bash", input: { command: "ls" } }]],
    ["fenced json", 'I will run:\n```json\n{"name": "bash", "arguments": {"command": "ls -la"}}\n```', [{ name: "bash", input: { command: "ls -la" } }]],
    ["bare json", 'Calling {"name": "read_file", "arguments": {"path": "b.ts"}} now', [{ name: "read_file", input: { path: "b.ts" } }]],
    ["function attr", '<function name="read_file">{"path": "c.ts"}</function>', [{ name: "read_file", input: { path: "c.ts" } }]],
    ["trailing comma", '<tool_call>{"name": "bash", "arguments": {"command": "ls",},}</tool_call>', [{ name: "bash", input: { command: "ls" } }]],
    [
      "two calls",
      '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>\n<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>',
      [
        { name: "read_file", input: { path: "a" } },
        { name: "read_file", input: { path: "b" } },
      ],
    ],
  ];
  for (const [label, text, expected] of cases)
    test(label, () => {
      expect(extractToolCalls(text, names).calls.map(({ name, input }) => ({ name, input }))).toEqual(expected);
    });

  test("ignores unknown tools, prose JSON and reasoning blocks", () => {
    expect(extractToolCalls('<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>', names).calls).toEqual([]);
    expect(extractToolCalls('The config is {"name": "app", "version": 1}.', names).calls).toEqual([]);
    expect(extractToolCalls('<think>maybe {"name":"bash","arguments":{"command":"x"}}</think>Done.', names).calls).toEqual([]);
  });

  test("strips markup from remaining text", () => {
    const r = extractToolCalls('Reading.\n<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>', names);
    expect(r.text).toBe("Reading.");
  });

  test("recoverToolCalls rewrites the message; leaves native calls alone", () => {
    const r = recoverToolCalls({ role: "assistant", content: [{ type: "text", text: '<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call>' }] }, names, "t");
    expect(r!.message.content).toEqual([{ type: "tool_call", id: "t_0", name: "bash", input: { command: "ls" } }]);
    expect(recoverToolCalls({ role: "assistant", content: [{ type: "tool_call", id: "x", name: "bash", input: {} }] }, names, "t")).toBeNull();
  });
});

describe("text protocol", () => {
  test("renders tool calls and results as text", () => {
    const out = toTextProtocol([
      { role: "assistant", content: [{ type: "tool_call", id: "1", name: "bash", input: { command: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", toolCallId: "1", content: "a.ts", isError: false }] },
    ]);
    expect(out[0]!.content[0]).toEqual({ type: "text", text: '<tool_call>\n{"name":"bash","arguments":{"command":"ls"}}\n</tool_call>' });
    expect((out[1]!.content[0] as { text: string }).text).toBe('<tool_result name="bash">\na.ts\n</tool_result>');
  });

  test("instructions list tools and required params", () => {
    const s = textProtocolInstructions(new ToolRegistry().specs().filter((t) => t.name === "read_file"));
    expect(s).toContain("- read_file:");
    expect(s).toContain("path (required): string");
  });

  test("agent completes a task end-to-end with text-only tool calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "ah-parser-"));
    writeFileSync(join(root, "m.ts"), "export const f = () => 1;\n");
    const seen: ChatRequest[] = [];
    const mock = new MockProvider({
      script: [
        { text: 'Reading.\n<tool_call>{"name":"read_file","arguments":{"path":"m.ts"}}</tool_call>' },
        { text: "<tool_call>\n<function=edit_file>\n<parameter=path>m.ts</parameter>\n<parameter=old_string>=> 1</parameter>\n<parameter=new_string>=> 2</parameter>\n</function>\n</tool_call>" },
        { text: "Changed f to return 2." },
      ],
    });
    const spy = { ...mock, key: "mock", kind: "mock", capabilities: mock.capabilities, stream: (r: ChatRequest): AsyncIterable<StreamEvent> => (seen.push(r), mock.stream(r)) };
    const events: string[] = [];
    const agent = new Agent({
      provider: spy,
      model: "scripted",
      system: "sys",
      tools: new ToolRegistry(),
      toolContext: { root, bashTimeoutMs: 5000, todos: [], readFiles: new Set(), media: {} },
      mode: "auto",
      maxTurns: 6,
      maxTokens: 100,
      toolProtocol: "text",
      onEvent: (e) => events.push(e.type),
    });
    const r = await agent.run("make f return 2");
    expect(r.outcome).toBe("completed");
    expect(r.toolCalls).toBe(2);
    expect(readFileSync(join(root, "m.ts"), "utf8")).toContain("=> 2");
    expect(events.filter((e) => e === "tool_calls_recovered")).toHaveLength(2);
    expect(seen[0]!.tools).toEqual([]);
    expect(seen[0]!.system).toContain("# Tool protocol");
    expect(JSON.stringify(seen[1]!.messages)).toContain("<tool_result name=\\\"read_file\\\">");
  });
});
