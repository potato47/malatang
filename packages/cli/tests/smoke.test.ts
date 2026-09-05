import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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

async function run(args: readonly string[], cwd = packageRoot, env = process.env) {
  const child = Bun.spawn([process.execPath, executable, ...args], {
    cwd,
    env,
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

  test("built CLI creates a local project whose installed package links to the checkout", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-built-local-"));
    roots.push(cwd);
    const created = await run(
      ["create", "local-app", "--local", "--template", "native", "--no-install"],
      cwd,
    );
    expect(created.exitCode).toBe(0);
    const projectRoot = resolve(cwd, "local-app");
    const env = {
      ...process.env,
      TMPDIR: cwd,
      BUN_INSTALL: resolve(cwd, "bun"),
      BUN_INSTALL_CACHE_DIR: resolve(cwd, "bun-cache"),
    };
    const registration = Bun.spawn([process.execPath, "link"], {
      cwd: packageRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [registered] = await Promise.all([
      registration.exited,
      new Response(registration.stdout).text(),
      new Response(registration.stderr).text(),
    ]);
    expect(registered).toBe(0);
    const install = Bun.spawn([process.execPath, "install", "--offline"], {
      cwd: projectRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      install.exited,
      new Response(install.stderr).text(),
      new Response(install.stdout).text(),
    ]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(await realpath(resolve(projectRoot, "node_modules/@semicoder/fia"))).toBe(
      await realpath(packageRoot),
    );
    const checked = await run(["check", "--json"], projectRoot);
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout).ok).toBe(true);
    const installed = await run(
      ["create", "installed-app", "--local", "--template", "native"],
      cwd,
      env,
    );
    expect(installed.stderr).not.toContain("error:");
    expect(installed.exitCode).toBe(0);
    expect(await realpath(resolve(cwd, "installed-app/node_modules/@semicoder/fia"))).toBe(
      await realpath(packageRoot),
    );
    const projectCheck = Bun.spawn([process.execPath, "run", "check"], {
      cwd: resolve(cwd, "installed-app"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [checkExitCode, checkOutput] = await Promise.all([
      projectCheck.exited,
      new Response(projectCheck.stdout).text(),
      new Response(projectCheck.stderr).text(),
    ]);
    expect(checkExitCode).toBe(0);
    expect(checkOutput).toContain("Result: ready");
  });
});
