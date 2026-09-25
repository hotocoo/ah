// Reads a model's chat template (Jinja) for the switches it accepts through chat_template_kwargs:
// reasoning effort levels, a thinking on/off switch (off = instruct mode), and any other variable
// the template checks with `is defined` or `|default(...)`. Nothing is assumed about a model;
// the levels offered are exactly the ones its template compares against.

export interface TemplateControl {
  name: string;
  type: "enum" | "boolean" | "number" | "string";
  values?: string[]; // for enum: the literals the template compares the variable (or its aliases) with
  default?: string | boolean | number;
}

// Variables every HF chat template receives from the renderer, not user switches.
const RENDERER_VARS = new Set(["messages", "tools", "documents", "add_generation_prompt", "bos_token", "eos_token", "tools_in_user_message", "date_string", "builtin_tools", "custom_tools", "system_message"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const literal = (s: string): string | boolean | number | undefined => {
  const t = s.trim();
  if (/^['"].*['"]$/.test(t)) return t.slice(1, -1);
  if (/^(true|True)$/.test(t)) return true;
  if (/^(false|False)$/.test(t)) return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
};

// Variables an expression reads: identifiers outside strings, minus Jinja words and filter names.
const JINJA_WORDS = new Set(["if", "else", "elif", "is", "not", "and", "or", "in", "defined", "none", "None", "true", "false", "True", "False", "iterable", "mapping", "string", "number", "sameas"]);
function readsOf(expr: string): Set<string> {
  const bare = expr.replace(/(['"])(?:(?!\1).)*\1/g, " ").replace(/\|\s*\w+(\s*\([^)]*\))?/g, " ");
  return new Set([...bare.matchAll(/(?<![\w.])([A-Za-z_]\w*)(?!\s*\()/g)].map((m) => m[1]!).filter((w) => !JINJA_WORDS.has(w)));
}

export function templateControls(template: string): TemplateControl[] {
  if (!template || !template.includes("{%")) return [];
  const names = new Set<string>();
  for (const m of template.matchAll(/(?<![\w.])([A-Za-z]\w*)\s+is\s+(?:not\s+)?defined|(?<![\w.])([A-Za-z]\w*)\s*\|\s*default\s*\(/g)) {
    const n = (m[1] ?? m[2])!;
    if (!RENDERER_VARS.has(n) && !n.startsWith("_")) names.add(n);
  }
  const out: TemplateControl[] = [];
  for (const name of names) {
    // Aliases: locals assigned from an expression that reads the variable, followed transitively
    // (`set resolved = reasoning_effort|default('x')`, then comparisons on `resolved`).
    const aliases = new Set([name]);
    for (let pass = 0; pass < 3; pass++)
      for (const m of template.matchAll(/set\s+([\w.]+)\s*=\s*([^%]+?)\s*-?%\}/g)) {
        const refs = readsOf(m[2]!);
        if (refs.size && [...refs].every((r) => aliases.has(r) || r.startsWith("_default")) && [...refs].some((r) => aliases.has(r))) aliases.add(m[1]!);
      }
    const values = new Set<string>();
    let def: string | boolean | number | undefined;
    let boolish = false;
    for (const a of aliases) {
      const A = esc(a);
      for (const m of template.matchAll(new RegExp(`(?<![\\w.])${A}\\s*(?:==|!=)\\s*(['"])([^'"]+)\\1`, "g"))) values.add(m[2]!);
      for (const m of template.matchAll(new RegExp(`(?<![\\w.])${A}\\s+(?:not\\s+)?in\\s*[(\\[]([^)\\]]*)[)\\]]`, "g")))
        for (const v of m[1]!.matchAll(/(['"])([^'"]+)\1/g)) values.add(v[2]!);
      if (new RegExp(`(?<![\\w.])${A}\\s+is\\s+(?:not\\s+)?(?:true|false|sameas)`).test(template) || new RegExp(`(?<![\\w.])${A}\\s*(?:==|!=)\\s*(?:true|false)`, "i").test(template)) boolish = true;
    }
    const N = esc(name);
    const d1 = new RegExp(`(?<![\\w.])${N}\\s*\\|\\s*default\\s*\\(\\s*([^)]+?)\\s*\\)`).exec(template);
    const d2 = new RegExp(`(?<![\\w.])${N}\\s+if\\s+${N}\\s+is\\s+defined[^%]*?else\\s+([^\\s%)]+)`).exec(template);
    const raw = d1?.[1] ?? d2?.[1];
    if (raw !== undefined) {
      def = literal(raw);
      // `else _default_x` names a local set to a literal elsewhere.
      if (def === undefined) {
        const set = new RegExp(`set\\s+${esc(raw.trim())}\\s*=\\s*([^%]+?)\\s*-?%\\}`).exec(template);
        if (set) def = literal(set[1]!);
      }
    }
    if (typeof def === "string") values.add(def);
    if (typeof def === "boolean" || typeof def === "number") values.clear();
    const type: TemplateControl["type"] = values.size ? "enum" : typeof def === "boolean" || boolish ? "boolean" : typeof def === "number" ? "number" : "string";
    out.push({ name, type, ...(values.size ? { values: [...values] } : {}), ...(def !== undefined ? { default: def } : {}) });
  }
  // Switches the model actually branches on first: enums, then booleans.
  const rank = { enum: 0, boolean: 1, number: 2, string: 3 } as const;
  return out.sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name));
}
