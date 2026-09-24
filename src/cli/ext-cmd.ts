import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AH_HOME, loadConfig } from "../config.ts";
import { McpManager } from "../mcp/client.ts";
import { MemoryStore } from "../memory/store.ts";
import { discoverExtensions, setTrusted } from "../plugins/index.ts";
import { bold, cyan, dim, green, red, yellow } from "./render.ts";

const out = (s: string) => process.stdout.write(`${s}\n`);

// `ah trust [dir]`: allow a workspace's own MCP servers, plugins and skills (they can run code).
export async function cmdTrust(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { remove: { type: "boolean" } } });
  const dir = resolve(positionals[0] ?? process.cwd());
  setTrusted(dir, !v.remove);
  out(v.remove ? `${yellow("untrusted")} ${dir}` : `${green("trusted")} ${dir} ${dim("(its .mcp.json, .ah/config.json mcpServers, .ah/plugins and .ah/skills will load)")}`);
  return 0;
}

// `ah mcp`: connect configured servers and list their tools.
export async function cmdMcp(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({ args: argv, options: { cwd: { type: "string", short: "C" }, json: { type: "boolean" } } });
  const root = resolve((v.cwd as string | undefined) ?? process.cwd());
  const ext = discoverExtensions(root);
  const mgr = new McpManager(ext.mcpServers);
  await mgr.start();
  const status = mgr.status();
  mgr.close();
  if (v.json) {
    out(JSON.stringify({ servers: status, skipped: ext.skipped }, null, 2));
    return 0;
  }
  if (!status.length) out(dim(`no MCP servers configured. Add "mcpServers" to ${join(AH_HOME, "config.json")} (Claude Desktop format), or a trusted workspace .mcp.json.`));
  for (const s of status) {
    const state = !s.enabled ? dim("disabled") : s.connected ? green("connected") : red("failed");
    out(`${cyan(s.name)} ${dim(s.transport)} ${state}${s.error ? ` ${red(s.error)}` : ""}`);
    if (s.tools.length) out(dim(`  ${s.tools.join(", ")}`));
  }
  if (ext.skipped.length) out(yellow(`workspace not trusted, skipped: ${ext.skipped.join(", ")}. Run \`ah trust\` to allow.`));
  return 0;
}

// `ah plugins`: plugins and skills that would load here.
export async function cmdPlugins(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({ args: argv, options: { cwd: { type: "string", short: "C" } } });
  const ext = discoverExtensions(resolve((v.cwd as string | undefined) ?? process.cwd()));
  out(bold(`plugins (${ext.plugins.length})`));
  for (const p of ext.plugins) out(`  ${cyan(p.manifest.name)} ${dim(`${p.source} · ${p.dir}`)}${p.manifest.description ? ` ${p.manifest.description}` : ""}`);
  out(bold(`skills (${ext.skills.length})`));
  for (const s of ext.skills) out(`  ${cyan(s.name)} ${dim(s.source)} ${s.description}`);
  if (ext.skipped.length) out(yellow(`workspace not trusted, skipped: ${ext.skipped.join(", ")}`));
  return 0;
}

// `ah memory [search <q> | list | rm <id> | add <text>]`
export async function cmdMemory(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { cwd: { type: "string", short: "C" }, global: { type: "boolean" }, json: { type: "boolean" } } });
  const root = resolve((v.cwd as string | undefined) ?? process.cwd());
  const cfg = loadConfig(root);
  const store = new MemoryStore(join(cfg.dataDir, "memory.sqlite"));
  const scopes = [root, "global"];
  const [sub = "list", ...rest] = positionals;
  const show = (ms: { id: number; kind: string; trust: number; uses: number; text: string; scope: string }[]) => {
    if (v.json) return out(JSON.stringify(ms, null, 2));
    for (const m of ms) out(`${cyan(`#${m.id}`)} ${dim(`${m.kind} · trust ${m.trust.toFixed(2)} · used ${m.uses}x · ${m.scope === "global" ? "global" : "workspace"}`)}\n  ${m.text.replace(/\n/g, "\n  ")}`);
    if (!ms.length) out(dim("no memories"));
  };
  try {
    if (sub === "search") show(store.search(rest.join(" "), scopes, 20, 0));
    else if (sub === "list") show(store.list(scopes));
    else if (sub === "rm") out(store.delete(Number(rest[0])) ? `deleted #${rest[0]}` : red(`no memory #${rest[0]}`));
    else if (sub === "add") out(`saved #${store.save({ scope: v.global ? "global" : root, kind: "note", text: rest.join(" ") })}`);
    else {
      out("usage: ah memory [list | search <query> | add <text> [--global] | rm <id>]");
      return 1;
    }
  } finally {
    store.close();
  }
  return 0;
}
