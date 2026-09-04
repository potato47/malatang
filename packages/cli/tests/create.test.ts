import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject } from "../src/create.ts";

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
      io: { stdout() {} },
    });
    const repositoryRoot = resolve(import.meta.dir, "../../..");
    const packagePath = resolve(root, "native/Package.swift");
    const manifest = (await readFile(packagePath, "utf8")).replace(
      /\.package\(url: "[^"]+", exact: "[^"]+"\)/u,
      `.package(path: ${JSON.stringify(repositoryRoot)})`,
    );
    await writeFile(packagePath, manifest, "utf8");
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
