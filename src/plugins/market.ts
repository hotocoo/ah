import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { McpServerConfig } from "../mcp/client.ts";

// Marketplace: live lookups against public registries, nothing listed by hand.
// - MCP servers: the official MCP registry (registry.modelcontextprotocol.io)
// - Skills: skills.sh search, installed from the skill's GitHub repository
const MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const SKILLS_SEARCH = "https://skills.sh/api/search";
const TIMEOUT = 15_000;

export interface McpListing {
  name: string;
  description: string;
  version: string;
  repository: string | null;
  // How to run it: a package runner command or a remote URL, and the variables it needs.
  install: { kind: "stdio" | "remote"; config: McpServerConfig; env: { name: string; description: string; required: boolean; secret: boolean }[] } | null;
}

interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type?: string };
  environmentVariables?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean }[];
  packageArguments?: { type?: string; value?: string; name?: string }[];
}
interface RegistryServer {
  name: string;
  description?: string;
  version?: string;
  repository?: { url?: string };
  packages?: RegistryPackage[];
  remotes?: { type?: string; url?: string; headers?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean }[] }[];
}

// Package type -> runner; the registry names the ecosystem, ah only maps it to its launcher.
const RUNNERS: Record<string, (p: RegistryPackage) => string[]> = {
  npm: (p) => ["npx", "-y", `${p.identifier}${p.version ? `@${p.version}` : ""}`],
  pypi: (p) => ["uvx", `${p.identifier}${p.version ? `==${p.version}` : ""}`],
  oci: (p) => ["docker", "run", "-i", "--rm", `${p.identifier}${p.version && !p.identifier?.includes(":") ? `:${p.version}` : ""}`],
};

export function toListing(s: RegistryServer): McpListing {
  const pkg = (s.packages ?? []).find((p) => p.registryType && RUNNERS[p.registryType] && (p.transport?.type ?? "stdio") === "stdio");
  const remote = (s.remotes ?? []).find((r) => r.url && (r.type === "streamable-http" || r.type === "sse"));
  let install: McpListing["install"] = null;
  if (pkg) {
    const [command, ...args] = RUNNERS[pkg.registryType!]!(pkg);
    const positional = (pkg.packageArguments ?? []).filter((a) => a.type === "positional" && a.value).map((a) => a.value!);
    install = {
      kind: "stdio",
      config: { command, args: [...args, ...positional] },
      env: (pkg.environmentVariables ?? []).map((e) => ({ name: e.name, description: e.description ?? "", required: Boolean(e.isRequired), secret: Boolean(e.isSecret) })),
    };
  } else if (remote) {
    install = {
      kind: "remote",
      config: { url: remote.url },
      env: (remote.headers ?? []).map((h) => ({ name: h.name, description: h.description ?? "", required: Boolean(h.isRequired), secret: Boolean(h.isSecret) })),
    };
  }
  return { name: s.name, description: s.description ?? "", version: s.version ?? "", repository: s.repository?.url ?? null, install };
}

export async function searchMcp(query: string, cursor?: string, fetchImpl: typeof fetch = fetch): Promise<{ servers: McpListing[]; next: string | null }> {
  const u = new URL(MCP_REGISTRY);
  u.searchParams.set("version", "latest");
  u.searchParams.set("limit", "50");
  if (query) u.searchParams.set("search", query);
  if (cursor) u.searchParams.set("cursor", cursor);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`MCP registry: HTTP ${res.status}`);
  const d = (await res.json()) as { servers: { server: RegistryServer }[]; metadata?: { nextCursor?: string } };
  return { servers: d.servers.map((x) => toListing(x.server)), next: d.metadata?.nextCursor ?? null };
}

export interface SkillListing {
  id: string; // owner/repo/skill
  source: string; // owner/repo on GitHub
  skillId: string;
  name: string;
  installs: number;
}

export async function searchSkills(query: string, fetchImpl: typeof fetch = fetch): Promise<SkillListing[]> {
  const u = new URL(SKILLS_SEARCH);
  u.searchParams.set("q", query || "code");
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`skills.sh: HTTP ${res.status}`);
  const d = (await res.json()) as { skills?: SkillListing[] };
  return (d.skills ?? []).map((s) => ({ id: s.id, source: s.source, skillId: s.skillId, name: s.name, installs: s.installs ?? 0 }));
}

const SAFE = /^[\w.-]+$/;

// Downloads a skill's folder (its SKILL.md and the files beside it) from GitHub into dest/<skillId>.
export async function installSkill(source: string, skillId: string, dest: string, fetchImpl: typeof fetch = fetch): Promise<{ dir: string; files: string[] }> {
  const [owner, repo] = source.split("/");
  if (!owner || !repo || !SAFE.test(owner) || !SAFE.test(repo) || !SAFE.test(skillId)) throw new Error("invalid skill source");
  const gh = (path: string) => fetchImpl(`https://api.github.com/repos/${owner}/${repo}${path ? `/${path}` : ""}`, { headers: { accept: "application/vnd.github+json", "user-agent": "ah" }, signal: AbortSignal.timeout(TIMEOUT) });
  const meta = await gh("");
  if (!meta.ok) throw new Error(`GitHub ${source}: HTTP ${meta.status}`);
  const branch = ((await meta.json()) as { default_branch: string }).default_branch;
  const treeRes = await gh(`git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!treeRes.ok) throw new Error(`GitHub tree: HTTP ${treeRes.status}`);
  const tree = ((await treeRes.json()) as { tree: { path: string; type: string; size?: number }[] }).tree;
  // The skill folder: a directory named skillId that holds SKILL.md (or the repo root for single-skill repos).
  const skillMd = tree.filter((t) => t.type === "blob" && /(^|\/)SKILL\.md$/i.test(t.path));
  const hit = skillMd.find((t) => t.path.split("/").at(-2) === skillId) ?? (skillMd.length === 1 ? skillMd[0] : undefined);
  if (!hit) throw new Error(`no SKILL.md for ${skillId} in ${source}`);
  const base = hit.path.includes("/") ? hit.path.slice(0, hit.path.lastIndexOf("/") + 1) : "";
  const files = tree.filter((t) => t.type === "blob" && t.path.startsWith(base) && (t.size ?? 0) < 1_000_000).slice(0, 200);
  const dir = join(dest, skillId);
  for (const f of files) {
    const rel = normalize(f.path.slice(base.length));
    if (rel.startsWith("..") || rel.startsWith("/")) continue;
    const raw = await fetchImpl(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!raw.ok) throw new Error(`download ${f.path}: HTTP ${raw.status}`);
    const out = join(dir, rel);
    if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await raw.arrayBuffer()));
  }
  return { dir, files: files.map((f) => f.path.slice(base.length)) };
}
