import { afterEach, describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import { CLI_VERSION } from "../src/metadata.ts";

const packageRoot = resolve(import.meta.dir, "..");
const executable = resolve(packageRoot, "bin/fia");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function run(args: readonly string[], cwd = packageRoot): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn([process.execPath, executable, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("published FIA 0.5 shape", () => {
  test("exports only config, MCP, MCP server, and native facades", () => {
    expect(packageMetadata.version).toBe(CLI_VERSION);
    expect(Object.keys(packageMetadata.exports)).toEqual([
      "./config",
      "./mcp",
      "./mcp/server",
      "./native",
    ]);
    expect(packageMetadata.exports).not.toHaveProperty("./runtime");
    expect(packageMetadata.exports).not.toHaveProperty("./backend");
    expect(packageMetadata.files).not.toContain("swift");
  });

  test("build output excludes old runtime and backend modules", async () => {
    for (const file of [
      "dist/config.js",
      "dist/config.d.ts",
      "dist/mcp.js",
      "dist/mcp.d.ts",
      "dist/mcp-server.js",
      "dist/mcp-server.d.ts",
      "dist/native.js",
      "dist/native.d.ts",
    ]) {
      expect(await Bun.file(resolve(packageRoot, file)).exists()).toBe(true);
    }
    for (const removed of ["dist/runtime.js", "dist/backend.js", "dist/managed-runtime.js"]) {
      expect(await Bun.file(resolve(packageRoot, removed)).exists()).toBe(false);
    }
  });

  test("packages a schema-5 Host manifest with MCP bridge metadata", async () => {
    const host = resolve(packageRoot, "assets/host/darwin-arm64/FIAHost");
    await access(host, constants.X_OK);
    const manifest = JSON.parse(await readFile(
      resolve(packageRoot, "assets/host/darwin-arm64/manifest.json"),
      "utf8",
    )) as Record<string, unknown>;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(host).arrayBuffer());
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      cliVersion: CLI_VERSION,
      hostVersion: CLI_VERSION,
      configurationSchema: 5,
      mcpBridge: 1,
      mcpProtocol: "2026-07-28",
      nativeCapabilities: ["tools", "resources", "subscriptions"],
      sha256: hasher.digest("hex"),
    });
  });

  test("built CLI creates MCP and --no-mcp projects", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-built-v3-"));
    temporaryDirectories.push(cwd);
    const normal = await run(["create", "mcp-app", "--no-install"], cwd);
    const uiOnly = await run(["create", "ui-only", "--no-install", "--no-mcp"], cwd);
    expect(normal.exitCode).toBe(0);
    expect(uiOnly.exitCode).toBe(0);
    expect(await Bun.file(resolve(cwd, "mcp-app/src/mcp/server.ts")).exists()).toBe(true);
    expect(await Bun.file(resolve(cwd, "ui-only/src/mcp/server.ts")).exists()).toBe(false);
  });
});
