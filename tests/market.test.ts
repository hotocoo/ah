import { expect, test } from "bun:test";
import { toListing } from "../src/plugins/market.ts";

test("registry entries map to runnable MCP configs by package type or remote", () => {
  const npm = toListing({ name: "io.x/fs", version: "1.2.0", packages: [{ registryType: "npm", identifier: "@x/fs", version: "1.2.0", transport: { type: "stdio" }, environmentVariables: [{ name: "ROOT", isRequired: true }] }] });
  expect(npm.install).toEqual({ kind: "stdio", config: { command: "npx", args: ["-y", "@x/fs@1.2.0"] }, env: [{ name: "ROOT", description: "", required: true, secret: false }] });
  const py = toListing({ name: "io.x/py", packages: [{ registryType: "pypi", identifier: "x-mcp", version: "0.3", transport: { type: "stdio" } }] });
  expect(py.install?.config).toEqual({ command: "uvx", args: ["x-mcp==0.3"] });
  const remote = toListing({ name: "io.x/remote", remotes: [{ type: "streamable-http", url: "https://x.dev/mcp", headers: [{ name: "Authorization", isSecret: true, isRequired: true }] }] });
  expect(remote.install).toMatchObject({ kind: "remote", config: { url: "https://x.dev/mcp" }, env: [{ name: "Authorization", secret: true }] });
  expect(toListing({ name: "io.x/none" }).install).toBeNull();
});
