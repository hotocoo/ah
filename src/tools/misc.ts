import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { walkFiles } from "./search.ts";
import { exec } from "./shell.ts";
import { confine, rel, str, ToolError, truncate, type TodoItem, type Tool } from "./types.ts";

export const todoTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "todo_write",
    description:
      "Replace the task list for this session. Use for multi-step work: keep exactly one item in_progress, mark items completed as soon as they are done.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: { content: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  summarize: (i) => `todos (${(i.todos as unknown[] | undefined)?.length ?? 0})`,
  async run(input, ctx) {
    const todos = input.todos as TodoItem[];
    ctx.todos.splice(0, ctx.todos.length, ...todos);
    const mark = { pending: "[ ]", in_progress: "[~]", completed: "[x]" } as const;
    return { content: todos.map((t) => `${mark[t.status]} ${t.content}`).join("\n") || "[no todos]" };
  },
};

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Blocks requests to loopback, link-local and private ranges (SSRF guard).
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1" || h.endsWith(".internal")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
}

export const webFetchTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "web_fetch",
    description: "Fetch a public http(s) URL (docs, API references, issues) and return its text content (HTML converted to text).",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  summarize: (i) => `fetch ${i.url}`,
  async run(input, ctx) {
    let url: URL;
    try {
      url = new URL(str(input, "url"));
    } catch {
      throw new ToolError("invalid URL");
    }
    if (!/^https?:$/.test(url.protocol)) throw new ToolError("only http(s) URLs are allowed");
    if (isPrivateHost(url.hostname)) throw new ToolError("refusing to fetch a private or loopback address");
    const res = await fetch(url, { signal: ctx.signal ?? AbortSignal.timeout(30_000), redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = type.includes("html") ? htmlToText(body) : body;
    return { content: truncate(`[${res.status} ${type}]\n${text}`, 50_000), isError: !res.ok };
  },
};

// Language-agnostic outline: top-level declarations per file, for fast orientation.
const DECL = /^\s*(export\s+)?(default\s+)?(async\s+)?(pub(\(crate\))?\s+)?(function\*?|class|interface|type|enum|struct|trait|impl|fn|def|func|const|let|module|object)\s+([A-Za-z_$][\w$]*)/;
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".rs", ".go", ".java", ".kt", ".rb", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".scala"]);

export function repoMap(root: string, base: string, maxFiles = 300): string {
  const out: string[] = [];
  let files = 0;
  for (const f of walkFiles(base)) {
    if (!SOURCE_EXT.has(extname(f))) continue;
    if (++files > maxFiles) {
      out.push(`[... more files omitted]`);
      break;
    }
    const lines = readFileSync(f, "utf8").split("\n");
    const decls: string[] = [];
    lines.forEach((l, i) => {
      const m = l.match(DECL);
      if (m && l.search(/\S/) <= 4) decls.push(`  ${i + 1}: ${m[6]} ${m[7]}`);
    });
    out.push(`${rel(root, f)} (${lines.length} lines)`);
    out.push(...decls.slice(0, 40));
    if (decls.length > 40) out.push(`  ... ${decls.length - 40} more`);
  }
  return out.join("\n") || "no source files";
}

export const repoMapTool: Tool = {
  readOnly: true,
  optional: true,
  spec: {
    name: "repo_map",
    description: "Outline source files under a path: each file with line count and its top-level declarations (functions, classes, types) with line numbers. Use first to orient in an unfamiliar codebase.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  summarize: (i) => `repo map ${i.path ?? "."}`,
  async run(input, ctx) {
    return { content: truncate(repoMap(ctx.root, confine(ctx.root, (input.path as string) || "."))) };
  },
};

export const gitTool: Tool = {
  readOnly: true,
  spec: {
    name: "git_status",
    description: "Show `git status --short` and the current diff (staged + unstaged) of the workspace, to review your changes.",
    inputSchema: { type: "object", properties: { stat_only: { type: "boolean" } } },
  },
  summarize: () => "git status/diff",
  available: (ctx) => existsSync(join(ctx.root, ".git")),
  async run(input, ctx) {
    const status = await exec("git status --short", ctx, 30_000);
    if (status.code !== 0) throw new ToolError(status.stderr.trim() || "not a git repository");
    const diff = await exec(input.stat_only ? "git diff HEAD --stat" : "git diff HEAD", ctx, 30_000);
    return { content: truncate(`${status.stdout.trim() || "[clean]"}\n\n${diff.stdout.trim()}`) };
  },
};

export const generateImageTool: Tool = {
  readOnly: false,
  spec: {
    name: "generate_image",
    description:
      "Generate an image from a text prompt with the configured image model and save it to `path` (png). Use for app assets, icons, placeholder art, textures, UI mockups.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        path: { type: "string", description: "Output file, e.g. assets/logo.png" },
        size: { type: "string", description: "WxH, e.g. 1024x1024" },
      },
      required: ["prompt", "path"],
    },
  },
  summarize: (i) => `image -> ${i.path}`,
  available: (ctx) => Boolean(ctx.media.generateImage),
  async run(input, ctx) {
    if (!ctx.media.generateImage) throw new ToolError("no image generation backend configured");
    const abs = confine(ctx.root, input.path);
    const [img] = await ctx.media.generateImage(str(input, "prompt"), { size: input.size as string | undefined });
    if (!img) throw new ToolError("image backend returned no images");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(img.data, "base64"));
    return {
      content: `saved ${rel(ctx.root, abs)} (${img.mediaType})`,
      images: [{ type: "image", mediaType: img.mediaType, data: img.data }],
      changedFiles: [rel(ctx.root, abs)],
    };
  },
};

export const generate3dTool: Tool = {
  readOnly: false,
  spec: {
    name: "generate_3d",
    description:
      "Generate a 3D model from a text description and save it (formats: glb, gltf, obj, stl). Use for game assets, printable parts, scene props. A PNG preview is written next to the model when available.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        path: { type: "string", description: "Output file, e.g. assets/chair.glb" },
      },
      required: ["prompt", "path"],
    },
  },
  summarize: (i) => `3d -> ${i.path}`,
  available: (ctx) => Boolean(ctx.media.generate3d),
  async run(input, ctx) {
    if (!ctx.media.generate3d) throw new ToolError("no 3D generation backend configured");
    const abs = confine(ctx.root, input.path);
    const format = extname(abs).slice(1).toLowerCase() || "glb";
    const out = await ctx.media.generate3d(str(input, "prompt"), { format });
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, out.data);
    const changed = [rel(ctx.root, abs)];
    const images = [];
    if (out.preview) {
      const previewPath = abs.replace(/\.[^.]+$/, "") + ".preview.png";
      writeFileSync(previewPath, Buffer.from(out.preview, "base64"));
      changed.push(rel(ctx.root, previewPath));
      images.push({ type: "image" as const, mediaType: "image/png", data: out.preview });
    }
    return { content: `saved ${changed.join(", ")} (${out.format}, ${out.data.length} bytes)`, images, changedFiles: changed };
  },
};
