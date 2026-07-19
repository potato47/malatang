import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { defineConfig, FIA_CONFIG_VERSION } from "../src/config.ts";
import {
  loadProjectConfig,
  ProjectConfigError,
  resolveProjectConfig,
  type ProjectConfigErrorCode,
} from "../src/project-config.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-test-"));
  temporaryDirectories.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/server.ts"), "export {};\n");
  return root;
}

async function expectConfigError(
  promise: Promise<unknown>,
  code: ProjectConfigErrorCode,
  path?: string,
): Promise<ProjectConfigError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    const configError = error as ProjectConfigError;
    expect(configError.code).toBe(code);
    if (path !== undefined) expect(configError.path).toBe(path);
    return configError;
  }
  throw new Error("Expected ProjectConfigError");
}

function minimal(): Record<string, unknown> {
  return {
    configVersion: 1,
    app: { name: "Hello", identifier: "com.example.hello" },
  };
}

describe("public FIA configuration", () => {
  test("defineConfig preserves the typed object and version constant", () => {
    const config = defineConfig({
      configVersion: FIA_CONFIG_VERSION,
      app: { name: "Hello", identifier: "com.example.hello" },
    });
    expect(config.app.name).toBe("Hello");
    expect(FIA_CONFIG_VERSION).toBe(1);
  });

  test("applies phase 1 defaults", async () => {
    const root = await project();
    const config = await resolveProjectConfig(minimal(), root);
    expect(config).toMatchObject({
      configVersion: 1,
      projectRoot: root,
      app: {
        name: "Hello",
        identifier: "com.example.hello",
        version: "0.1.0",
        quitOnLastWindowClosed: true,
      },
      entry: resolve(root, "src/server.ts"),
      window: { width: 1024, height: 700, minWidth: 720, minHeight: 480 },
    });
  });

  test("loads a default TypeScript export from the project root", async () => {
    const root = await project();
    await writeFile(resolve(root, "fia.config.ts"), `
      export default {
        configVersion: 1,
        app: {
          name: "Loaded App",
          identifier: "com.example.loaded",
          version: "2.3.4",
          quitOnLastWindowClosed: false,
        },
        entry: "src/server.ts",
        window: { width: 900, height: 600, minWidth: 500, minHeight: 400 },
      };
    `);
    const config = await loadProjectConfig(root);
    expect(config.app).toEqual({
      name: "Loaded App",
      identifier: "com.example.loaded",
      version: "2.3.4",
      quitOnLastWindowClosed: false,
    });
    expect(config.window.width).toBe(900);
  });

  test("rejects missing, unknown, and incorrectly typed fields", async () => {
    const root = await project();
    await expectConfigError(resolveProjectConfig({ app: {} }, root), "CONFIG_INVALID", "configVersion");
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), surprise: true }, root),
      "CONFIG_INVALID",
      "surprise",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), app: { name: "Hello", identifier: 42 } }, root),
      "CONFIG_INVALID",
      "app.identifier",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), window: { width: 800, typo: 1 } }, root),
      "CONFIG_INVALID",
      "window.typo",
    );
  });

  test("rejects unsupported versions, identifiers, app versions, and dimensions", async () => {
    const root = await project();
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), configVersion: 2 }, root),
      "CONFIG_UNSUPPORTED_VERSION",
      "configVersion",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), app: { name: "Hello", identifier: "hello" } }, root),
      "CONFIG_INVALID",
      "app.identifier",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), app: { name: "Hello", identifier: "com.example.hello", version: "v1" } }, root),
      "CONFIG_INVALID",
      "app.version",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), window: { width: Number.NaN } }, root),
      "CONFIG_INVALID",
      "window.width",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), window: { width: 500, minWidth: 700 } }, root),
      "CONFIG_INVALID",
      "window.width",
    );
  });

  test("requires an existing readable entry inside the project", async () => {
    const root = await project();
    const outsideRoot = await project();
    await symlink(resolve(outsideRoot, "src/server.ts"), resolve(root, "src/linked.ts"));
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), entry: resolve(root, "src/server.ts") }, root),
      "CONFIG_ENTRY_INVALID",
      "entry",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), entry: "../outside.ts" }, root),
      "CONFIG_ENTRY_INVALID",
      "entry",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), entry: "src/missing.ts" }, root),
      "CONFIG_ENTRY_INVALID",
      "entry",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), entry: "src/linked.ts" }, root),
      "CONFIG_ENTRY_INVALID",
      "entry",
    );
  });

  test("reports missing and unimportable config files without exposing implementation errors", async () => {
    const root = await project();
    await expectConfigError(loadProjectConfig(root), "CONFIG_NOT_FOUND");
    await writeFile(resolve(root, "fia.config.ts"), "export default { this is invalid };\n");
    await expectConfigError(loadProjectConfig(root), "CONFIG_IMPORT_FAILED");
  });
});
