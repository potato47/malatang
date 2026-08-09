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
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function run(args: readonly string[], cwd = packageRoot) {
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

describe("published FIA resident backend shape", () => {
  test("exports only config and Bun backend APIs", () => {
    expect(packageMetadata.version).toBe(CLI_VERSION);
    expect(Object.keys(packageMetadata.exports)).toEqual(["./config", "./backend"]);
    expect(packageMetadata.exports).not.toHaveProperty("./mcp");
    expect(packageMetadata.exports).not.toHaveProperty("./native");
  });

  test("build output excludes browser bridges and MCP", async () => {
    for (const file of [
      "dist/config.js",
      "dist/config.d.ts",
      "dist/backend.js",
      "dist/backend.d.ts",
    ]) {
      expect(await Bun.file(resolve(packageRoot, file)).exists()).toBe(true);
    }
    for (const removed of [
      "dist/mcp.js",
      "dist/mcp-server.js",
      "dist/native.js",
      "dist/runtime.js",
    ]) {
      expect(await Bun.file(resolve(packageRoot, removed)).exists()).toBe(false);
    }
  });

  test("packages a schema-7 Host manifest with stdio capabilities", async () => {
    const host = resolve(packageRoot, "assets/host/darwin-arm64/FIAHost");
    await access(host, constants.X_OK);
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "assets/host/darwin-arm64/manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(host).arrayBuffer());
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      cliVersion: CLI_VERSION,
      hostVersion: CLI_VERSION,
      configurationSchema: 7,
      stdioProtocol: 2,
      hostCapabilities: [
        "application",
        "statusItem",
        "webviews",
        "system",
        "notifications",
        "dialogs",
        "clipboard",
        "keychain",
      ],
      sha256: hasher.digest("hex"),
    });
  });

  test("built CLI creates a required backend project and rejects --no-mcp", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-built-v4-"));
    temporaryDirectories.push(cwd);
    const created = await run(["create", "service-app", "--no-install"], cwd);
    const legacy = await run(["create", "legacy", "--no-install", "--no-mcp"], cwd);
    expect(created.exitCode).toBe(0);
    expect(legacy.exitCode).toBe(2);
    expect(await Bun.file(resolve(cwd, "service-app/src/backend.ts")).exists()).toBe(true);
  });
});
