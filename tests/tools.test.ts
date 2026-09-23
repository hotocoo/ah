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

  test("edit_file requires a prior read", async () => {
    const r = await run("edit_file", { path: "src/a.ts", old_string: "a - b", new_string: "a + b" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/read src\/a.ts before editing/);
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
