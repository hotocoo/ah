import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mentionedFiles } from "../src/agent/mentions.ts";
import { findFiles } from "../src/server/server.ts";

const root = mkdtempSync(join(tmpdir(), "ah-mention-"));
mkdirSync(join(root, "src"));
writeFileSync(join(root, "src", "math.ts"), "export const add = (a: number, b: number) => a - b;\n");
writeFileSync(join(root, "README.md"), "hi\n");
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("@path attaches existing workspace files, numbered, and ignores the rest", () => {
  const a = mentionedFiles(root, "fix @src/math.ts, see @README.md. mail me@x.io; @missing.ts @../etc/passwd");
  expect(a.map((x) => x.path)).toEqual(["src/math.ts", "README.md"]);
  expect(a[0]!.text).toBe("1\texport const add = (a: number, b: number) => a - b;\n2\t");
});

test("file search ranks file-name matches first", () => {
  expect(findFiles(root, "math")).toEqual(["src/math.ts"]);
  expect(findFiles(root, "mts")).toEqual(["src/math.ts"]);
  expect(findFiles(root, "")).toHaveLength(2);
});
