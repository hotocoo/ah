import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../src/tools/index.ts";
import { isPrivateHost, repoMap } from "../src/tools/misc.ts";
import { validate } from "../src/tools/schema.ts";
import { detectTestCommand, isDangerousCommand } from "../src/tools/shell.ts";
import { applyEdit } from "../src/tools/fs.ts";
import { confine, type ToolContext } from "../src/tools/types.ts";

const roots: string[] = [];
const mkRoot = () => {
  const r = mkdtempSync(join(tmpdir(), "ah-tools-"));
  roots.push(r);
  return r;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

let root: string;
let ctx: ToolContext;
const reg = new ToolRegistry();
const run = (name: string, input: Record<string, unknown>, mode: "auto" | "ask" | "read-only" = "auto", approve?: () => Promise<boolean>) =>
  reg.execute(name, input, ctx, mode, approve);

beforeEach(() => {
  root = mkRoot();
  ctx = { root, bashTimeoutMs: 10_000, todos: [], readFiles: new Set(), media: {} };
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "a.ts"), "export function add(a: number, b: number) {\n  return a - b;\n}\n");
});

describe("path confinement", () => {
  test("rejects traversal and absolute escapes", () => {
    expect(() => confine(root, "../x")).toThrow(/escapes/);
    expect(() => confine(root, "/etc/passwd")).toThrow(/escapes/);
    expect(confine(root, "src/a.ts")).toBe(join(root, "src", "a.ts"));
  });

  test("rejects symlinks pointing outside the root", () => {
    const outside = mkRoot();
    symlinkSync(outside, join(root, "link"));
    expect(() => confine(root, "link/file.txt")).toThrow(/symlink/);
  });
});

describe("file tools", () => {
  test("read_file numbers lines and records the read", async () => {
    const r = await run("read_file", { path: "src/a.ts" });
    expect(r.isError).toBeFalsy();
    expect(r.content.split("\n")[1]).toBe("2\t  return a - b;");
    expect(ctx.readFiles.has(join(root, "src", "a.ts"))).toBe(true);
  });

  test("edit_file on an unread file needs a prior read unless old_string matches exactly once", async () => {
    // Not an exact match (would need the tolerant matcher): the model has not seen the real text.
    const r = await run("edit_file", { path: "src/a.ts", old_string: "  return a-b;", new_string: "a + b" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/read src\/a.ts before editing/);
    // Exact, unique text (e.g. copied from grep output) is grounded in the file: applied, file counts as read.
    writeFileSync(join(root, "g.ts"), "export const greet = getUserName;\n");
    const ok = await run("edit_file", { path: "g.ts", old_string: "getUserName", new_string: "getDisplayName" });
    expect(ok.isError).toBeFalsy();
    expect(readFileSync(join(root, "g.ts"), "utf8")).toBe("export const greet = getDisplayName;\n");
    expect(ctx.readFiles.has(join(root, "g.ts"))).toBe(true);
  });

  test("edit_file replaces a unique match and reports changed files", async () => {
    await run("read_file", { path: "src/a.ts" });
    const r = await run("edit_file", { path: "src/a.ts", old_string: "a - b", new_string: "a + b" });
    expect(r.isError).toBeFalsy();
    expect(r.changedFiles).toEqual(["src/a.ts"]);
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toContain("a + b");
  });

  test("applyEdit rejects ambiguous and missing matches", () => {
    expect(() => applyEdit("x x", "x", "y", false)).toThrow(/2 times/);
    expect(applyEdit("x x", "x", "y", true)).toBe("y y");
    expect(() => applyEdit("abc", "zzz", "y", false)).toThrow(/not found/);
    expect(applyEdit("a$b", "$", "$&", false)).toBe("a$&b"); // no regex replacement patterns
  });

  test("multi_edit is atomic", async () => {
    await run("read_file", { path: "src/a.ts" });
    const r = await run("multi_edit", {
      path: "src/a.ts",
      edits: [
        { old_string: "a - b", new_string: "a + b" },
        { old_string: "does-not-exist", new_string: "x" },
      ],
    });
    expect(r.isError).toBe(true);
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toContain("a - b");
  });

  test("write_file creates dirs; refuses to clobber unread files", async () => {
    expect((await run("write_file", { path: "new/dir/b.ts", content: "x" })).isError).toBeFalsy();
    const r = await run("write_file", { path: "src/a.ts", content: "clobber" });
    expect(r.isError).toBe(true);
  });

  test("list_dir, glob, grep", async () => {
    writeFileSync(join(root, "src", "b.py"), "def sub(a, b):\n    return a - b\n");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "junk.ts"), "a - b");
    expect((await run("list_dir", {})).content).toContain("src/");
    expect((await run("list_dir", {})).content).not.toContain("node_modules");
    expect((await run("glob", { pattern: "**/*.py" })).content).toBe("src/b.py");
    const g = await run("grep", { pattern: "a - b" });
    expect(g.content).toContain("src/a.ts:2:");
    expect(g.content).toContain("src/b.py:2:");
    expect(g.content).not.toContain("node_modules");
  });

  test("repo_map outlines declarations", () => {
    const map = repoMap(root, root);
    expect(map).toContain("src/a.ts (4 lines)");
    expect(map).toContain("1: function add");
  });
});

describe("shell + permissions", () => {
  test("bash captures output and exit code", async () => {
    const ok = await run("bash", { command: "echo hi && echo err >&2" });
    expect(ok.content).toContain("hi");
    expect(ok.content).toContain("[stderr]\nerr");
    expect(ok.content).toContain("[exit 0]");
    const bad = await run("bash", { command: "exit 3" });
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain("[exit 3]");
  });

  test("bash times out", async () => {
    const r = await run("bash", { command: "sleep 5", timeout_ms: 1000 });
    expect(r.content).toContain("[timed out]");
  });

  test("dangerous commands need approval even in auto mode", async () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("git push origin main --force")).toBe(true);
    expect(isDangerousCommand("rm -rf dist")).toBe(false);
    const r = await run("bash", { command: "sudo ls" }, "auto");
    expect(r.denied).toBe(true);
  });

  test("ask mode consults approver for writes only", async () => {
    let asked = 0;
    const approve = async () => {
      asked++;
      return false;
    };
    await run("read_file", { path: "src/a.ts" }, "ask", approve);
    expect(asked).toBe(0);
    const w = await run("write_file", { path: "z.txt", content: "z" }, "ask", approve);
    expect(asked).toBe(1);
    expect(w.denied).toBe(true);
  });

  test("read-only mode hides and blocks write tools", async () => {
    expect(reg.specs("read-only").map((s) => s.name)).not.toContain("bash");
    const r = await run("bash", { command: "echo" }, "read-only");
    expect(r.denied).toBe(true);
  });

  test("unknown tools and schema violations return errors instead of throwing", async () => {
    expect((await run("nope", {})).content).toMatch(/unknown tool/);
    const r = await run("read_file", { path: 5 });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("input.path: expected string");
  });

  test("detectTestCommand", () => {
    const r = mkRoot();
    expect(detectTestCommand(r)).toBeNull();
    writeFileSync(join(r, "Cargo.toml"), "");
    expect(detectTestCommand(r)).toBe("cargo test");
    writeFileSync(join(r, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    writeFileSync(join(r, "pnpm-lock.yaml"), "");
    expect(detectTestCommand(r)).toBe("pnpm test");
  });

  test("todo_write replaces the list", async () => {
    const r = await run("todo_write", { todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "pending" }] });
    expect(r.content).toBe("[~] a\n[ ] b");
    expect(ctx.todos).toHaveLength(2);
  });
});

describe("validation + ssrf", () => {
  test("validate", () => {
    const s = { type: "object", properties: { n: { type: "integer", minimum: 1 }, e: { enum: ["a"] } }, required: ["n"], additionalProperties: false };
    expect(validate(s, { n: 2 })).toEqual([]);
    expect(validate(s, {})).toEqual(["input.n: required"]);
    expect(validate(s, { n: 0, e: "b", x: 1 })).toHaveLength(3);
  });

  test("isPrivateHost", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "[::1]"]) expect(isPrivateHost(h)).toBe(true);
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1"]) expect(isPrivateHost(h)).toBe(false);
  });
});

describe("tolerant edits", () => {
  test("matches despite wrong indentation and re-indents the replacement", async () => {
    const { applyEditTolerant } = await import("../src/tools/edit-match.ts");
    const file = "function f() {\n  if (x) {\n    return a - b;\n  }\n}\n";
    const r = applyEditTolerant(file, "\tif (x) {\n\t  return a - b;", "\tif (x) {\n\t  return a + b;", false);
    expect(r.strategy).toBe("whitespace");
    expect(r.text).toBe("function f() {\n  if (x) {\n    return a + b;\n  }\n}\n");
  });

  test("exact match preferred; CRLF preserved; ambiguity and misses reported with hints", async () => {
    const { applyEditTolerant } = await import("../src/tools/edit-match.ts");
    expect(applyEditTolerant("a\r\nb\r\n", "b", "c", false)).toEqual({ text: "a\r\nc\r\n", strategy: "exact" });
    expect(() => applyEditTolerant("  x;\n  x;\n", "    x;", "y;", false)).toThrow(/2 places/);
    expect(() => applyEditTolerant("  const start = page * size;\n", "const begin = p * s;", "z", false)).toThrow(/not found/);
    try {
      applyEditTolerant("line one\n  const start = page * size;\n", "const start = pages * sizes", "z", false);
    } catch (e) {
      expect((e as Error).message).toContain('2: "  const start = page * size;"');
    }
  });

  test("edit_file reports the tolerant match", async () => {
    writeFileSync(join(root, "p.ts"), "export function p() {\n  const start = page * size;\n}\n");
    await run("read_file", { path: "p.ts" });
    const r = await run("edit_file", { path: "p.ts", old_string: "    const start = page * size;", new_string: "    const start = (page - 1) * size;" });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain("ignoring indentation");
    expect(readFileSync(join(root, "p.ts"), "utf8")).toContain("\n  const start = (page - 1) * size;\n");
  });

  // Seen in MiMo-9B bench telemetry: old_string copied with read_file's "N\t" prefixes or a stray ">" quote marker.
  test("strips copied line-number prefixes and quote markers from old_string", async () => {
    const { applyEditTolerant } = await import("../src/tools/edit-match.ts");
    const file = "// Stack is a LIFO stack.\ntype Stack[T any] struct {\n}\n";
    expect(applyEditTolerant(file, ">>> type Stack[T any] struct {", "type Stack[T any] struct {\n\titems []T", false).text).toContain("struct {\n\titems []T\n}");
    const numbered = applyEditTolerant(file, "2\ttype Stack[T any] struct {\n3\t}", "2\ttype Stack[T any] struct{}", false);
    expect(numbered.text).toBe("// Stack is a LIFO stack.\ntype Stack[T any] struct{}\n");
    expect(numbered.strategy).toBe("prefix");
  });

  test("says when the edit already looks applied", async () => {
    const { applyEditTolerant } = await import("../src/tools/edit-match.ts");
    expect(() => applyEditTolerant("const start = (page - 1) * size;\n", "const start = page * size;", "const start = (page - 1) * size;", false)).toThrow(/already contains new_string/);
  });
});

describe("path recovery", () => {
  test("a path repeating the workspace's own trailing dirs resolves inside it", () => {
    const ws = join(root, "work", "go-feature-stack", "1");
    mkdirSync(ws, { recursive: true });
    expect(confine(ws, "work/go-feature-stack/1/stack.go")).toBe(join(ws, "stack.go"));
    expect(confine(ws, "1/stack.go")).toBe(join(ws, "stack.go"));
    // A real directory of that name wins.
    mkdirSync(join(ws, "1"));
    expect(confine(ws, "1/stack.go")).toBe(join(ws, "1", "stack.go"));
  });
});

describe("process hygiene", () => {
  test("timeout kills grandchildren that hold the pipe open", async () => {
    const t0 = performance.now();
    // The backgrounded sleep inherits stdout; killing only sh would hang the read.
    const r = await run("bash", { command: "(sleep 30; echo late) & sleep 30", timeout_ms: 1000 });
    expect(r.content).toContain("[timed out]");
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  test("secret-looking environment variables are not visible to commands", async () => {
    process.env.AH_TEST_API_KEY = "sk-should-not-leak";
    process.env.AH_TEST_PLAIN = "visible";
    const r = await run("bash", { command: "env" });
    expect(r.content).not.toContain("sk-should-not-leak");
    expect(r.content).toContain("AH_TEST_PLAIN=visible");
    delete process.env.AH_TEST_API_KEY;
    delete process.env.AH_TEST_PLAIN;
  });
});

describe("workspace-only shell", () => {
  test.if(process.platform === "darwin")("sandboxed shell writes inside the workspace and tmp, not elsewhere in home", async () => {
    const { shellPrefix } = await import("../src/tools/sandbox.ts");
    const { exec } = await import("../src/tools/shell.ts");
    const { homedir } = await import("node:os");
    const ws = mkdtempSync(join(homedir(), ".ah-sbx-ws-"));
    const outside = join(homedir(), `.ah-sbx-outside-${process.pid}`);
    try {
      const prefix = shellPrefix(ws);
      expect(prefix?.[0]).toBe("sandbox-exec");
      const ok = await exec("echo hi > inside.txt && echo t > \"${TMPDIR:-/tmp}/ah-sbx-$$\" && cat inside.txt", { root: ws, shellPrefix: prefix }, 10_000);
      expect(ok.code).toBe(0);
      expect(ok.stdout.trim()).toBe("hi");
      const bad = await exec(`echo x > ${JSON.stringify(outside)}`, { root: ws, shellPrefix: prefix }, 10_000);
      expect(bad.code).not.toBe(0);
      expect(bad.stderr).toMatch(/not permitted/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });
});

describe("python test command", () => {
  test("uses an interpreter that exists on PATH", async () => {
    const { detectTestCommand, pythonBin } = await import("../src/tools/shell.ts");
    const d = mkdtempSync(join(tmpdir(), "ah-py-"));
    writeFileSync(join(d, "test_x.py"), "def test_x():\n    assert True\n");
    const cmd = detectTestCommand(d)!;
    expect(cmd).toBe(`${pythonBin()} -m pytest -q`);
    expect(Bun.which(cmd.split(" ")[0]!)).not.toBeNull();
    rmSync(d, { recursive: true, force: true });
  });
});
