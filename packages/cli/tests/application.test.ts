import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeApplicationCommand, injectCSPNonce } from "../src/application.ts";
import { createProject } from "../src/create.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(name = "build-app"): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-application-test-"));
  temporaryDirectories.push(cwd);
  const root = await createProject({
    name,
    cwd,
    install: false,
    initializeGit: false,
    io: { stdout: () => {} },
    dependencies: { cliPackageSpec: `file:${packageRoot}` },
  });
  const modules = resolve(root, "node_modules");
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  await symlink(resolve(repositoryRoot, "node_modules/typescript"), resolve(modules, "typescript"), "dir");
  await symlink(resolve(repositoryRoot, "node_modules/@types/bun"), resolve(modules, "@types/bun"), "dir");
  for (const dependency of ["react", "react-dom"] as const) {
    await symlink(resolve(packageRoot, "node_modules", dependency), resolve(modules, dependency), "dir");
    await symlink(
      resolve(packageRoot, "node_modules/@types", dependency),
      resolve(modules, "@types", dependency),
      "dir",
    );
  }
  return root;
}

function output(): { stdout: string[]; stderr: string[]; io: { stdout(value: string): void; stderr(value: string): void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
  };
}

describe("FIA application commands", () => {
  test("injects CSP nonces only into HTML tags, not JavaScript strings", () => {
    const html = '<style>.example { color: red; }</style><script>const warning = "<script async>";</script>';
    expect(injectCSPNonce(html, "test-nonce")).toBe(
      '<style nonce="test-nonce">.example { color: red; }</style>'
        + '<script nonce="test-nonce">const warning = "<script async>";</script>',
    );
  });

  test("builds, verifies, and atomically replaces a production app", async () => {
    const root = await project("unicode-app");
    const configPath = resolve(root, "fia.config.ts");
    await writeFile(configPath, (await readFile(configPath, "utf8")).replace("Unicode App", "测试 App"));

    const first = output();
    await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: first.io });
    const app = resolve(root, "dist/测试 App.app");
    expect(await Bun.file(resolve(app, "Contents/Info.plist")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIAHost")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/MacOS/fia-runtime")).exists()).toBe(true);
    expect(JSON.parse(await readFile(resolve(app, "Contents/Resources/fia-config.json"), "utf8"))).toMatchObject({
      schemaVersion: 3,
      app: { mode: "dock" },
      window: { closeBehavior: "quit", restoreState: true },
      statusBar: { symbol: "circle.grid.2x2.fill" },
      runtime: { mode: "production" },
    });

    const second = output();
    await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: second.io });
    expect(second.stdout.join("")).toContain(`Built ${app}`);
    expect(second.stderr).toEqual([]);
  }, 20_000);

  test("rejects legacy Bun.serve entries with migration guidance", async () => {
    const root = await project("legacy-app");
    await writeFile(resolve(root, "src/server.ts"), `
      Bun.serve({ port: 0, fetch: () => new Response("legacy") });
    `);
    await expect(executeApplicationCommand({
      command: "build",
      cwd: root,
      debug: false,
      io: output().io,
    })).rejects.toThrow("Direct Bun.serve() entries are not supported");
    expect(await Bun.file(resolve(root, "dist/Legacy App.app/Contents/Info.plist")).exists()).toBe(false);
  });

  test("builds status bar and hybrid desktop modes with schema three", async () => {
    for (const mode of ["statusBar", "hybrid"] as const) {
      const root = await project(`${mode.toLowerCase()}-app`);
      const configPath = resolve(root, "fia.config.ts");
      const source = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        source
          .replace('mode: "dock"', `mode: "${mode}"`)
          .replace('closeBehavior: "quit"', 'closeBehavior: "hide"'),
      );
      await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: output().io });
      const appName = mode === "statusBar" ? "Statusbar App" : "Hybrid App";
      const configuration = JSON.parse(await readFile(
        resolve(root, `dist/${appName}.app/Contents/Resources/fia-config.json`),
        "utf8",
      )) as Record<string, unknown>;
      expect(configuration).toMatchObject({
        schemaVersion: 3,
        app: { mode },
        window: { closeBehavior: "hide" },
      });
    }
  }, 30_000);
});
