import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AH_HOME } from "../config.ts";
import type { McpServerConfig } from "../mcp/client.ts";
import type { Tool } from "../tools/types.ts";

// Extensions, discovered from disk (D18). A plugin is a directory with plugin.json:
//   { "name", "description", "mcpServers": {...}, "instructions": "text or file.md",
//     "tools": "tools.ts" (module exporting `tools: Tool[]`), "skills": "skills" }
// A plugin directory may also carry a Claude Code style .mcp.json and skills/ folder.
// Skills follow the agentskills.io layout: <dir>/<name>/SKILL.md with name/description
// frontmatter. Only an index goes into the prompt; skill_view loads the body on demand.
//
// Anything that comes from the workspace (project config, .mcp.json, .ah/plugins) can
// start processes or load code, so it is used only for workspaces the user trusted in
// ~/.ah/config.json ("trustedWorkspaces"), never on the project's own say-so.

export interface PluginManifest {
  name: string;
  description?: string;
  mcpServers?: Record<string, McpServerConfig>;
  instructions?: string;
  tools?: string;
  skills?: string;
}

export interface Plugin {
  dir: string;
  source: "user" | "workspace";
  manifest: PluginManifest;
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  source: string;
}

export interface Extensions {
  plugins: Plugin[];
  mcpServers: Record<string, McpServerConfig>;
  skills: Skill[];
  instructions: string[];
  trusted: boolean;
  skipped: string[]; // workspace-provided extensions ignored because the workspace is not trusted
  errors: string[];
}

const readJson = <T,>(p: string): T | null => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((d) => !d.startsWith(".") && statSync(join(p, d)).isDirectory()).sort() : []);

export function userConfig(home = AH_HOME): { mcpServers?: Record<string, McpServerConfig>; trustedWorkspaces?: string[]; skillDirs?: string[] } {
  return readJson(join(home, "config.json")) ?? {};
}

export function isTrusted(root: string, home = AH_HOME): boolean {
  const r = resolve(root);
  return (userConfig(home).trustedWorkspaces ?? []).some((t) => r === resolve(t) || r.startsWith(`${resolve(t)}/`));
}

// Minimal frontmatter reader: `key: value` lines between leading --- fences.
export function frontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

export function scanSkills(dir: string, source: string): Skill[] {
  return dirs(dir).flatMap((d) => {
    const path = join(dir, d, "SKILL.md");
    if (!existsSync(path)) return [];
    const fm = frontmatter(readFileSync(path, "utf8").slice(0, 4000));
    return [{ name: fm.name || d, description: (fm.description || "").slice(0, 300), path, source }];
  });
}

function loadPlugin(dir: string, source: Plugin["source"]): Plugin | null {
  const manifest = readJson<PluginManifest>(join(dir, "plugin.json")) ?? readJson<PluginManifest>(join(dir, ".claude-plugin", "plugin.json"));
  if (!manifest) return null;
  const mcp = readJson<{ mcpServers?: Record<string, McpServerConfig> }>(join(dir, ".mcp.json"));
  return { dir, source, manifest: { ...manifest, name: manifest.name || dir.split("/").pop()!, mcpServers: { ...mcp?.mcpServers, ...manifest.mcpServers } } };
}

export function discoverExtensions(root: string, home = AH_HOME): Extensions {
  const user = userConfig(home);
  const trusted = isTrusted(root, home);
  const ext: Extensions = { plugins: [], mcpServers: {}, skills: [], instructions: [], trusted, skipped: [], errors: [] };
  const addServers = (servers: Record<string, McpServerConfig> | undefined, prefix = "") => {
    for (const [k, v] of Object.entries(servers ?? {})) ext.mcpServers[prefix + k] = v;
  };

  addServers(user.mcpServers);
  for (const d of dirs(join(home, "plugins"))) {
    const p = loadPlugin(join(home, "plugins", d), "user");
    if (p) ext.plugins.push(p);
  }
  ext.skills.push(...scanSkills(join(home, "skills"), "user"));
  for (const d of user.skillDirs ?? []) ext.skills.push(...scanSkills(resolve(d), d));

  const project = readJson<{ mcpServers?: Record<string, McpServerConfig> }>(join(root, ".ah", "config.json"));
  const dotMcp = readJson<{ mcpServers?: Record<string, McpServerConfig> }>(join(root, ".mcp.json"));
  const wsPlugins = dirs(join(root, ".ah", "plugins"))
    .map((d) => loadPlugin(join(root, ".ah", "plugins", d), "workspace"))
    .filter((p): p is Plugin => p !== null);
  const wsSkills = scanSkills(join(root, ".ah", "skills"), "workspace");
  if (trusted) {
    addServers(project?.mcpServers);
    addServers(dotMcp?.mcpServers);
    ext.plugins.push(...wsPlugins);
    ext.skills.push(...wsSkills);
  } else {
    ext.skipped.push(
      ...Object.keys(project?.mcpServers ?? {}).map((k) => `mcp server ${k} (.ah/config.json)`),
      ...Object.keys(dotMcp?.mcpServers ?? {}).map((k) => `mcp server ${k} (.mcp.json)`),
      ...wsPlugins.map((p) => `plugin ${p.manifest.name}`),
      ...wsSkills.map((s) => `skill ${s.name}`),
    );
  }

  for (const p of ext.plugins) {
    addServers(p.manifest.mcpServers, `${p.manifest.name}_`);
    if (p.manifest.instructions) {
      const f = join(p.dir, p.manifest.instructions);
      const text = p.manifest.instructions.endsWith(".md") && existsSync(f) ? readFileSync(f, "utf8") : p.manifest.instructions;
      ext.instructions.push(`<plugin name="${p.manifest.name}">\n${text.slice(0, 8000)}\n</plugin>`);
    }
    ext.skills.push(...scanSkills(join(p.dir, p.manifest.skills ?? "skills"), `plugin:${p.manifest.name}`));
  }
  // Later sources do not shadow earlier ones with the same skill name.
  const seen = new Set<string>();
  ext.skills = ext.skills.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
  return ext;
}

// Loads plugin tool modules. Each exports `tools` (or default) as Tool[].
export async function loadPluginTools(ext: Extensions): Promise<Tool[]> {
  const out: Tool[] = [];
  for (const p of ext.plugins) {
    if (!p.manifest.tools) continue;
    try {
      const mod = (await import(join(p.dir, p.manifest.tools))) as { tools?: Tool[]; default?: Tool[] };
      const tools = mod.tools ?? mod.default ?? [];
      for (const t of tools) if (t?.spec?.name && typeof t.run === "function") out.push({ ...t, optional: t.optional ?? true });
    } catch (err) {
      ext.errors.push(`plugin ${p.manifest.name}: ${(err as Error).message}`);
    }
  }
  return out.sort((a, b) => a.spec.name.localeCompare(b.spec.name));
}

export function renderSkillIndex(skills: Skill[]): string {
  if (!skills.length) return "";
  return `Skills are step-by-step procedures for specific tasks. When one matches the task, load it with skill_view before starting.\n${skills
    .map((s) => `- ${s.name}: ${s.description || "(no description)"}`)
    .sort()
    .join("\n")}`;
}

export function skillViewTool(skills: Skill[]): Tool {
  return {
    readOnly: true,
    optional: true,
    spec: {
      name: "skill_view",
      description: "Load the full instructions of a skill listed in the system prompt.",
      inputSchema: { type: "object", properties: { name: { type: "string", enum: skills.map((s) => s.name).sort() } }, required: ["name"] },
    },
    summarize: (i) => `skill ${i.name}`,
    async run(input) {
      const s = skills.find((x) => x.name === input.name);
      if (!s) return { content: `unknown skill: ${input.name}`, isError: true };
      return { content: readFileSync(s.path, "utf8").slice(0, 40_000) };
    },
  };
}
