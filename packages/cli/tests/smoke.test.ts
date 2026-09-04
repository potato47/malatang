import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import { CLI_VERSION } from "../src/metadata.ts";

const packageRoot = resolve(import.meta.dir, "..");
const executable = resolve(packageRoot, "bin/fia");
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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

describe("published FIA 2.0 shape", () => {
  test("exports the browser client, optional Bun adapter, and Vite integration", async () => {
    expect(packageMetadata.version).toBe(CLI_VERSION);
    expect(Object.keys(packageMetadata.exports)).toEqual(["./client", "./backend", "./vite"]);
    for (const file of [
      "dist/client.js",
      "dist/client.d.ts",
      "dist/backend.js",
      "dist/backend.d.ts",
      "dist/vite.js",
      "dist/vite.d.ts",
    ]) {
      expect(await Bun.file(resolve(packageRoot, file)).exists()).toBe(true);
    }
    expect(await Bun.file(resolve(packageRoot, "dist/config.js")).exists()).toBe(false);
  });

  test("built CLI creates default Web/no-Bun and generates contracts", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-built-v2-"));
    roots.push(cwd);
    const created = await run(["create", "service-app", "--no-install"], cwd);
    expect(created.exitCode).toBe(0);
    expect(await Bun.file(resolve(cwd, "service-app/fia.toml")).exists()).toBe(true);
    expect(await Bun.file(resolve(cwd, "service-app/backend/index.ts")).exists()).toBe(false);
    expect((await run(["generate", "--check"], resolve(cwd, "service-app"))).exitCode).toBe(0);
  });
});
