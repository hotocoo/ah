import { expect, test } from "bun:test";
import { templateControls } from "../src/models/template.ts";

test("reads effort levels through aliases, thinking switch and typed defaults from a chat template", () => {
  const t = `{%- set enable_thinking = enable_thinking if enable_thinking is defined else true %}
{%- set resolved = reasoning_effort|default('medium') %}
{%- if resolved not in ('low', 'medium', 'high', 'xhigh') %}{{ raise_exception('bad') }}{%- endif %}
{%- if resolved == 'xhigh' %}deep{%- endif %}
{%- set limit = max_chars if max_chars is defined else 0 %}
{%- if messages[0].content is defined %}{%- endif %}`;
  const c = templateControls(t);
  expect(c[0]!.values!.sort()).toEqual(["high", "low", "medium", "xhigh"]);
  expect(c).toEqual([
    { name: "reasoning_effort", type: "enum", values: expect.any(Array), default: "medium" },
    { name: "enable_thinking", type: "boolean", default: true },
    { name: "max_chars", type: "number", default: 0 },
  ]);
});

test("templates without switches (or non-Jinja templates) yield nothing", () => {
  expect(templateControls("{{ messages }}")).toEqual([]);
  expect(templateControls("{{ .Prompt }}")).toEqual([]);
});
