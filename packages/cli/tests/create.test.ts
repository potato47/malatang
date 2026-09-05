import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject } from "../src/create.ts";
import { checkProject } from "../src/check.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("FIA 2.0 project templates", () => {
  for (const template of ["native", "web", "hybrid"] as const) {
    for (const backend of [false, true]) {
      test(`${template}${backend ? " + Bun" : ""}`, async () => {
        const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-v2-"));
        roots.push(cwd);
        const root = await createProject({
          name: `sample-${template}${backend ? "-bun" : ""}`,
          cwd,
          install: false,
          initializeGit: false,
          template,
          backend,
          io: { stdout() {} },
          dependencies: { cliPackageSpec: "file:../fia" },
        });
        expect(await Bun.file(resolve(root, "fia.toml")).text()).toContain("schema = 2");
        expect(await Bun.file(resolve(root, "native/Package.swift")).exists()).toBe(true);
        expect(await Bun.file(resolve(root, "native/Sources/FIAApp/App.swift")).exists()).toBe(
          true,
        );
        expect(await Bun.file(resolve(root, "generated/native-api.ts")).exists()).toBe(true);
        expect(await Bun.file(resolve(root, "frontend/App.tsx")).exists()).toBe(
          template !== "native",
        );
        expect(await Bun.file(resolve(root, "backend/index.ts")).exists()).toBe(backend);
      });
    }
  }

  for (const template of ["native", "web", "hybrid"] as const) {
    for (const backend of [false, true]) {
      test(`local ${template}${backend ? " + Bun" : ""} passes project checks`, async () => {
        const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-local-"));
        roots.push(cwd);
        const repositoryRoot = resolve(import.meta.dir, "../../..");
        const installed: string[] = [];
        const root = await createProject({
          name: "local-app",
          cwd,
          local: true,
          install: true,
          initializeGit: false,
          template,
          backend,
          io: { stdout() {} },
          dependencies: {
            runner: async (command, directory) => {
              expect(command).toEqual([process.execPath, "install"]);
              const metadata = await Bun.file(resolve(directory, "package.json")).json();
              installed.push(metadata.devDependencies["@semicoder/fia"]);
              await mkdir(resolve(directory, "node_modules/@semicoder"), { recursive: true });
              await symlink(
                resolve(repositoryRoot, "packages/cli"),
                resolve(directory, "node_modules/@semicoder/fia"),
              );
              return 0;
            },
          },
        });
        expect(installed).toEqual(["link:@semicoder/fia"]);
        expect(await readFile(resolve(root, "native/Package.swift"), "utf8")).toContain(
          `.package(name: "fia", path: ${JSON.stringify(repositoryRoot)})`,
        );
        const report = await checkProject(root);
        expect(report.ok).toBe(true);
        expect(report.checks.find((check) => check.id === "native-package")?.message).toContain(
          `local FIA at ${repositoryRoot}`,
        );
        expect(await readFile(resolve(root, "README.md"), "utf8")).toContain("bun run cli:build");
      });
    }
  }

  test("resolves a linked CLI in a checkout with a different name and spaces", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-linked-"));
    roots.push(cwd);
    const repositoryRoot = resolve(import.meta.dir, "../../..");
    const checkout = resolve(cwd, 'framework "development"');
    const cliDirectory = resolve(checkout, "packages/cli");
    await mkdir(cliDirectory, { recursive: true });
    await copyFile(resolve(repositoryRoot, "Package.swift"), resolve(checkout, "Package.swift"));
    await copyFile(
      resolve(repositoryRoot, "packages/cli/package.json"),
      resolve(cliDirectory, "package.json"),
    );
    await symlink(resolve(repositoryRoot, "Sources"), resolve(checkout, "Sources"));
    await symlink(resolve(repositoryRoot, "packages/cli/src"), resolve(cliDirectory, "src"));
    const linkedPackage = resolve(cwd, "linked-cli");
    await symlink(cliDirectory, linkedPackage);
    const root = await createProject({
      name: "linked-app",
      cwd,
      local: true,
      install: false,
      initializeGit: false,
      io: { stdout() {} },
      dependencies: { cliPackageDirectory: linkedPackage },
    });
    expect(
      (await Bun.file(resolve(root, "package.json")).json()).devDependencies["@semicoder/fia"],
    ).toBe("link:@semicoder/fia");
    expect(await readFile(resolve(root, "native/Package.swift"), "utf8")).toContain(
      `.package(name: "fia", path: ${JSON.stringify(await realpath(checkout))})`,
    );
    expect((await checkProject(root)).ok).toBe(true);
  });

  test("rejects --local outside a source checkout before creating or installing anything", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-invalid-local-"));
    roots.push(cwd);
    await expect(
      createProject({
        name: "invalid-local",
        cwd,
        local: true,
        install: true,
        initializeGit: false,
        io: { stdout() {} },
        dependencies: {
          cliPackageDirectory: resolve(cwd, "missing-package"),
          runner: async () => {
            throw new Error("installation must not start");
          },
        },
      }),
    ).rejects.toThrow("--local requires running FIA from a source checkout");
    expect(await readdir(cwd)).toEqual([]);
  });

  test("rejects a Bun link to another checkout and removes the incomplete project", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-wrong-link-"));
    roots.push(cwd);
    await expect(
      createProject({
        name: "wrong-link",
        cwd,
        local: true,
        install: true,
        initializeGit: false,
        io: { stdout() {} },
        dependencies: {
          runner: async (_command, directory) => {
            await mkdir(resolve(directory, "node_modules/@semicoder"), { recursive: true });
            await symlink(cwd, resolve(directory, "node_modules/@semicoder/fia"));
            return 0;
          },
        },
      }),
    ).rejects.toThrow("but Swift uses");
    expect(await readdir(cwd)).toEqual([]);
  });

  test("generated native executable compiles against the workspace FIA package", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-create-build-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "compiled-native",
      cwd,
      install: false,
      initializeGit: false,
      template: "native",
      backend: false,
      local: true,
      io: { stdout() {} },
    });
    const repositoryRoot = resolve(import.meta.dir, "../../..");
    expect((await checkProject(root)).ok).toBe(true);
    await copyFile(
      resolve(repositoryRoot, "Package.resolved"),
      resolve(root, "native/Package.resolved"),
    );
    const moduleCache = resolve(root, ".swift-module-cache");
    const swiftPMCache = Bun.env.FIA_SWIFTPM_CACHE_PATH ?? resolve(tmpdir(), "fia-swiftpm-cache");
    const process = Bun.spawn(
      [
        "swift",
        "build",
        "--disable-sandbox",
        "--only-use-versions-from-resolved-file",
        "--cache-path",
        swiftPMCache,
        "--package-path",
        resolve(root, "native"),
      ],
      {
        cwd: root,
        env: processEnv({
          CLANG_MODULE_CACHE_PATH: moduleCache,
          SWIFTPM_MODULECACHE_OVERRIDE: moduleCache,
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(`${stdout}\n${stderr}`).toContain("Build complete!");
    expect(exitCode).toBe(0);
  }, 120_000);
});

function processEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(Bun.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    ...overrides,
  };
}
