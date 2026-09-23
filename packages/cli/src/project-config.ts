import { lstat, realpath, readFile } from "node:fs/promises";
import { isAbsolute, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { FIAConfig } from "./config.ts";

export interface ResolvedFIAConfig extends FIAConfig {
  projectRoot: string;
  configPath: string;
  api: { entry: string };
  backend: { entry: string; assets: readonly string[] };
  web: { root: string; dist: string };
  permissions: Readonly<Record<string, string>>;
}
export class ProjectConfigError extends Error {
  readonly code = "CONFIG_INVALID";
}
const fail = (message: string): never => {
  throw new ProjectConfigError(message);
};
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(name + " must be an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(name + "." + key + " is not supported in FIA 4");
}
function nonempty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.includes("\0"))
    fail(name + " must be a non-empty string");
}
export function safeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !/[\p{Cc}%?#:]/u.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
export function httpsURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
export function validateConfig(input: unknown, root: string): ResolvedFIAConfig {
  const value = object(input, "config");
  keys(
    value,
    ["app", "api", "agent", "backend", "web", "permissions", "statusItem", "updates", "signing"],
    "config",
  );
  const app = object(value.app, "app");
  keys(app, ["name", "identifier", "version", "build", "icon"], "app");
  for (const key of ["name", "identifier", "version"]) nonempty(app[key], "app." + key);
  if (
    !/^[^/\\:\p{Cc}]{1,100}$/u.test(app.name as string) ||
    [".", ".."].includes(app.name as string)
  )
    fail("app.name must be a safe application filename");
  if (!/^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/u.test(app.identifier as string))
    fail("app.identifier must be a reverse DNS identifier");
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(app.version as string))
    fail("app.version must be a semantic version");
  if (!Number.isSafeInteger(app.build) || (app.build as number) < 1)
    fail("app.build must be a positive safe integer");
  const agent = object(value.agent, "agent");
  keys(agent, ["command", "description", "instructions"], "agent");
  nonempty(agent.command, "agent.command");
  nonempty(agent.description, "agent.description");
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(agent.command) ||
    agent.command.length > 64 ||
    agent.command === "fia"
  )
    fail("agent.command must be a skill-compatible command name, other than fia");
  if (agent.description.length > 1024) fail("agent.description must be at most 1024 characters");
  const api = object(value.api ?? {}, "api");
  keys(api, ["entry"], "api");
  const apiEntry = api.entry ?? "shared/api.ts";
  const backend = object(value.backend ?? {}, "backend");
  const web = object(value.web ?? {}, "web");
  keys(backend, ["entry", "assets"], "backend");
  keys(web, ["root", "dist"], "web");
  const entry = backend.entry ?? "backend/index.ts";
  const webRoot = web.root ?? "frontend";
  const dist = web.dist ?? "frontend/dist";
  const assets = backend.assets ?? [];
  if (!Array.isArray(assets)) fail("backend.assets must be an array of relative paths");
  for (const path of [
    entry,
    apiEntry,
    ...(agent.instructions === undefined ? [] : [agent.instructions]),
    webRoot,
    dist,
    ...(assets as unknown[]),
    ...(app.icon === undefined ? [] : [app.icon]),
  ]) {
    if (typeof path !== "string" || !safeRelative(path))
      fail("Project paths must be safe relative paths");
    if ([".git", "node_modules", ".fia"].includes((path as string).split("/")[0]!))
      fail("Project path is reserved: " + path);
  }
  const permissions = object(value.permissions ?? {}, "permissions");
  for (const [key, description] of Object.entries(permissions)) {
    if (!/^NS[A-Za-z]+UsageDescription$/u.test(key))
      fail("permissions keys must be macOS UsageDescription keys");
    nonempty(description, "permissions." + key);
  }
  if (value.statusItem !== undefined) {
    const item = object(value.statusItem, "statusItem");
    keys(item, ["symbol", "tooltip"], "statusItem");
    nonempty(item.symbol, "statusItem.symbol");
    if (item.tooltip !== undefined) nonempty(item.tooltip, "statusItem.tooltip");
  }
  if (value.updates !== undefined) {
    const updates = object(value.updates, "updates");
    keys(updates, ["url", "publicKey", "downloadURL"], "updates");
    nonempty(updates.url, "updates.url");
    nonempty(updates.publicKey, "updates.publicKey");
    if (!httpsURL(updates.url)) fail("updates.url must be HTTPS");
    if (
      !/^[A-Za-z0-9+/]{43}=$/u.test(updates.publicKey) ||
      Buffer.from(updates.publicKey, "base64").length !== 32
    )
      fail("updates.publicKey must be a base64 Ed25519 public key (32 bytes)");
    if (
      updates.downloadURL !== undefined &&
      (typeof updates.downloadURL !== "string" || !httpsURL(updates.downloadURL))
    )
      fail("updates.downloadURL must be HTTPS");
  }
  if (value.signing !== undefined) {
    const signing = object(value.signing, "signing");
    keys(signing, ["developmentIdentity", "releaseIdentity", "notarizationProfile"], "signing");
    for (const [key, item] of Object.entries(signing)) nonempty(item, "signing." + key);
  }
  return {
    ...(value as unknown as FIAConfig),
    projectRoot: resolve(root),
    configPath: resolve(root, "fia.config.ts"),
    api: { entry: apiEntry as string },
    backend: { entry: entry as string, assets: assets as string[] },
    web: { root: webRoot as string, dist: dist as string },
    permissions: permissions as Record<string, string>,
  };
}
export async function loadProjectConfig(root: string): Promise<ResolvedFIAConfig> {
  root = await realpath(root);
  const path = resolve(root, "fia.config.ts");
  try {
    await readFile(path);
  } catch {
    fail(
      "fia.config.ts was not found. FIA 2 projects must be migrated; fia.toml and Swift application targets are no longer supported.",
    );
  }
  // Bun caches filesystem modules without their query string. Bundle into a unique
  // module so edits to the config and its imports are visible on the next run.
  const built = await Bun.build({
    entrypoints: [path],
    target: "bun",
    format: "esm",
    define: {
      "import.meta.dir": JSON.stringify(root),
      "import.meta.path": JSON.stringify(path),
      "import.meta.url": JSON.stringify(pathToFileURL(path).href),
    },
  });
  if (!built.success) fail("Cannot load fia.config.ts: " + built.logs.join("\n"));
  const source = await built.outputs[0]!.text();
  const moduleURL =
    "data:text/javascript;base64," +
    Buffer.from(source + "\n// " + crypto.randomUUID()).toString("base64");
  const imported = (await import(moduleURL)) as {
    default: unknown;
  };
  const config = validateConfig(imported.default, root);
  if (!config.app.icon && (await Bun.file(resolve(root, "assets/icon.icns")).exists()))
    config.app.icon = "assets/icon.icns";
  for (const entry of [
    config.backend.entry,
    config.api.entry,
    ...(config.agent.instructions ? [config.agent.instructions] : []),
    config.web.root,
    ...config.backend.assets,
    ...(config.app.icon ? [config.app.icon] : []),
  ]) {
    const actual = await realpath(resolve(root, entry));
    const rel = relative(root, actual);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
      fail("Project path escapes project: " + entry);
    await lstat(actual);
  }
  return config;
}
