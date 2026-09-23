import type { ContentBlock, Message, ToolSpec } from "../core/types.ts";

// Extracts tool calls that a model wrote as text instead of structured tool_calls.
// Local servers do this whenever they cannot map the model's native format (unknown
// chat template, no --jinja, fine-tunes). Formats seen in the wild are handled; a call
// is accepted only if its name is one of the offered tools.

export interface ParsedCall {
  name: string;
  input: Record<string, unknown>;
  format: string;
}

export interface ParseResult {
  calls: ParsedCall[];
  text: string; // remaining prose with the tool-call markup removed
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Tolerate trailing commas and single-quoted keys common in small-model output.
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

const asArgs = (v: unknown): Record<string, unknown> | null => {
  if (typeof v === "string") v = parseJson(v);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : v === undefined || v === null ? {} : null;
};

// {"name": ..., "arguments"|"parameters"|"input"|"args": ...}; also {"function": {...}}.
function fromObject(o: unknown, known: Set<string>, format: string): ParsedCall | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const inner = (r.function && typeof r.function === "object" ? r.function : r) as Record<string, unknown>;
  const name = inner.name ?? inner.tool ?? inner.tool_name;
  if (typeof name !== "string" || !known.has(name)) return null;
  const input = asArgs(inner.arguments ?? inner.parameters ?? inner.input ?? inner.args ?? {});
  return input ? { name, input, format } : null;
}

// Balanced-brace JSON object scanner starting at `from`.
function scanObject(s: string, from: number): { json: string; end: number } | null {
  const start = s.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { json: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

// Value of an XML-ish parameter: JSON if it parses to a non-string, else the raw text.
function paramValue(raw: string): unknown {
  const t = raw.replace(/^\n/, "").replace(/\n$/, "");
  const j = parseJson(t.trim());
  return j !== undefined && typeof j !== "string" ? j : t;
}

type Extractor = (text: string, known: Set<string>) => { calls: ParsedCall[]; spans: [number, number][] };

const EXTRACTORS: Extractor[] = [
  // Qwen3-Coder style: <function=name><parameter=key>value</parameter></function>, optionally in <tool_call>.
  (text, known) => {
    const calls: ParsedCall[] = [];
    const spans: [number, number][] = [];
    const re = /(?:<tool_call>\s*)?<function=([\w.-]+)>([\s\S]*?)<\/function>(?:\s*<\/tool_call>)?/g;
    for (const m of text.matchAll(re)) {
      if (!known.has(m[1]!)) continue;
      const input: Record<string, unknown> = {};
      for (const p of m[2]!.matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) input[p[1]!] = paramValue(p[2]!);
      calls.push({ name: m[1]!, input, format: "xml-function" });
      spans.push([m.index!, m.index! + m[0].length]);
    }
    return { calls, spans };
  },
  // Anthropic-like XML: <invoke name="x"><parameter name="k">v</parameter></invoke>.
  (text, known) => {
    const calls: ParsedCall[] = [];
    const spans: [number, number][] = [];
    for (const m of text.matchAll(/<invoke name="([\w.-]+)">([\s\S]*?)<\/invoke>/g)) {
      if (!known.has(m[1]!)) continue;
      const input: Record<string, unknown> = {};
      for (const p of m[2]!.matchAll(/<parameter name="([\w.-]+)">([\s\S]*?)<\/parameter>/g)) input[p[1]!] = paramValue(p[2]!);
      calls.push({ name: m[1]!, input, format: "xml-invoke" });
      spans.push([m.index!, m.index! + m[0].length]);
    }
    return { calls, spans };
  },
  // Hermes/Qwen: <tool_call>{json}</tool_call>; also <function_call>, <tools>, and Gemma-ish <function name="x">{json}</function>.
  (text, known) => {
    const calls: ParsedCall[] = [];
    const spans: [number, number][] = [];
    for (const m of text.matchAll(/<(tool_call|function_call|toolcall|tools)>([\s\S]*?)<\/\1>/g)) {
      const body = m[2]!.trim();
      const j = parseJson(body);
      const items = Array.isArray(j) ? j : [j];
      const got = items.map((x) => fromObject(x, known, `tag-${m[1]}`)).filter((c): c is ParsedCall => c !== null);
      if (got.length) {
        calls.push(...got);
        spans.push([m.index!, m.index! + m[0].length]);
      }
    }
    for (const m of text.matchAll(/<function name="([\w.-]+)">([\s\S]*?)<\/function>/g)) {
      if (!known.has(m[1]!)) continue;
      const input = asArgs(m[2]!.trim());
      if (!input) continue;
      calls.push({ name: m[1]!, input, format: "function-attr" });
      spans.push([m.index!, m.index! + m[0].length]);
    }
    return { calls, spans };
  },
  // Mistral: [TOOL_CALLS][{...}] or [TOOL_CALLS]name[ARGS]{...}; Llama 3: <|python_tag|>{...}.
  (text, known) => {
    const calls: ParsedCall[] = [];
    const spans: [number, number][] = [];
    for (const m of text.matchAll(/\[TOOL_CALLS\]\s*([\w.-]+)\[ARGS\]/g)) {
      const obj = scanObject(text, m.index! + m[0].length);
      const input = obj ? asArgs(obj.json) : null;
      if (obj && input && known.has(m[1]!)) {
        calls.push({ name: m[1]!, input, format: "mistral-args" });
        spans.push([m.index!, obj.end]);
      }
    }
    for (const m of text.matchAll(/\[TOOL_CALLS\]\s*(\[[\s\S]*?\])(?=\s*(?:$|\[TOOL_CALLS\]|<\/s>))/g)) {
      const arr = parseJson(m[1]!);
      const got = Array.isArray(arr) ? arr.map((x) => fromObject(x, known, "mistral")).filter((c): c is ParsedCall => c !== null) : [];
      if (got.length) {
        calls.push(...got);
        spans.push([m.index!, m.index! + m[0].length]);
      }
    }
    for (const m of text.matchAll(/<\|python_tag\|>/g)) {
      const obj = scanObject(text, m.index! + m[0].length);
      const c = obj ? fromObject(parseJson(obj.json), known, "python-tag") : null;
      if (obj && c) {
        calls.push(c);
        spans.push([m.index!, obj.end]);
      }
    }
    return { calls, spans };
  },
  // Fenced ```json blocks, then bare JSON objects, naming a known tool.
  (text, known) => {
    const calls: ParsedCall[] = [];
    const spans: [number, number][] = [];
    for (const m of text.matchAll(/```(?:json|tool_call|tool)?\s*\n([\s\S]*?)```/g)) {
      const j = parseJson(m[1]!.trim());
      const items = Array.isArray(j) ? j : [j];
      const got = items.map((x) => fromObject(x, known, "fenced-json")).filter((c): c is ParsedCall => c !== null);
      if (got.length) {
        calls.push(...got);
        spans.push([m.index!, m.index! + m[0].length]);
      }
    }
    if (calls.length) return { calls, spans };
    let from = 0;
    for (;;) {
      const obj = scanObject(text, from);
      if (!obj) break;
      const c = fromObject(parseJson(obj.json), known, "bare-json");
      if (c) {
        calls.push(c);
        spans.push([obj.end - obj.json.length, obj.end]);
      }
      from = obj.end;
    }
    return { calls, spans };
  },
];

export function extractToolCalls(text: string, toolNames: string[]): ParseResult {
  const known = new Set(toolNames);
  // Reasoning written inline is not a tool call.
  const visible = text.replace(/<think>[\s\S]*?<\/think>/g, (m) => " ".repeat(m.length));
  for (const ex of EXTRACTORS) {
    const { calls, spans } = ex(visible, known);
    if (!calls.length) continue;
    let rest = "";
    let pos = 0;
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
      rest += text.slice(pos, a);
      pos = b;
    }
    rest += text.slice(pos);
    return { calls, text: rest.replace(/<think>[\s\S]*?<\/think>/g, "").trim() };
  }
  return { calls: [], text };
}

// Rewrites an assistant message whose tool calls are embedded in text.
export function recoverToolCalls(message: Message, toolNames: string[], idPrefix: string): { message: Message; formats: string[] } | null {
  if (message.content.some((b) => b.type === "tool_call")) return null;
  const text = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  if (!text) return null;
  const r = extractToolCalls(text, toolNames);
  if (!r.calls.length) return null;
  const content: ContentBlock[] = [
    ...message.content.filter((b) => b.type === "thinking"),
    ...(r.text ? [{ type: "text" as const, text: r.text }] : []),
    ...r.calls.map((c, i) => ({ type: "tool_call" as const, id: `${idPrefix}_${i}`, name: c.name, input: c.input })),
  ];
  return { message: { role: "assistant", content }, formats: [...new Set(r.calls.map((c) => c.format))] };
}

// ----- Text protocol: for models/runtimes without native tool calling -----

export function textProtocolInstructions(tools: ToolSpec[]): string {
  const defs = tools
    .map((t) => {
      const props = t.inputSchema.properties ?? {};
      const req = new Set(t.inputSchema.required ?? []);
      const params = Object.entries(props)
        .map(([k, v]) => `    - ${k}${req.has(k) ? " (required)" : ""}: ${Array.isArray(v.type) ? v.type.join("|") : (v.type ?? "any")}${v.description ? ` — ${v.description}` : ""}`)
        .join("\n");
      return `- ${t.name}: ${t.description}\n${params}`;
    })
    .join("\n");
  return `# Tool protocol
You call tools by writing one or more blocks exactly like this, then STOP and wait for the results:
<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>
Arguments must be valid JSON. Results come back in <tool_result name="..."> blocks. When the task is done, reply without any tool_call block.

# Available tools
${defs}`;
}

// Converts native tool blocks to plain text so any chat template can render them.
export function toTextProtocol(messages: Message[]): Message[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    const parts: string[] = [];
    const images: ContentBlock[] = [];
    for (const b of m.content) {
      if (b.type === "text") parts.push(b.text);
      else if (b.type === "tool_call") {
        names.set(b.id, b.name);
        parts.push(`<tool_call>\n${JSON.stringify({ name: b.name, arguments: b.input })}\n</tool_call>`);
      } else if (b.type === "tool_result")
        parts.push(`<tool_result name="${names.get(b.toolCallId) ?? "tool"}"${b.isError ? ' error="true"' : ""}>\n${b.content}\n</tool_result>`);
      else if (b.type === "image") images.push(b);
    }
    return { role: m.role, content: [...(parts.length ? [{ type: "text" as const, text: parts.join("\n\n") }] : []), ...images] };
  });
}
