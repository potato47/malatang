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
  await mkdir(resolve(root, "src/ui"), { recursive: true });
  await writeFile(resolve(root, "src/server.ts"), "export {};\n");
  await writeFile(resolve(root, "src/ui/index.html"), "<div>test</div>\n");
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
    configVersion: 2,
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
    expect(FIA_CONFIG_VERSION).toBe(2);
  });

  test("applies phase 1 defaults", async () => {
    const root = await project();
    const config = await resolveProjectConfig(minimal(), root);
    expect(config).toMatchObject({
      configVersion: 2,
      projectRoot: root,
      app: {
        name: "Hello",
        identifier: "com.example.hello",
        version: "0.1.0",
        mode: "dock",
      },
      runtime: "bun",
      entry: resolve(root, "src/server.ts"),
      ui: resolve(root, "src/ui/index.html"),
      window: {
        width: 1024,
        height: 700,
        minWidth: 720,
        minHeight: 480,
        closeBehavior: "quit",
        restoreState: true,
        alwaysOnTop: false,
        visibleOnAllSpaces: false,
        visibleOverFullScreen: false,
      },
      statusBar: { symbol: "circle.grid.2x2.fill", tooltip: "Hello" },
    });
  });

  test("supports a static UI configuration without a Bun entry", async () => {
    const root = await project();
    await rm(resolve(root, "src/server.ts"));
    const config = await resolveProjectConfig({ ...minimal(), runtime: "none" }, root);
    expect(config.runtime).toBe("none");
    expect(config.entry).toBeUndefined();
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), runtime: "none", entry: "src/server.ts" }, root),
      "CONFIG_INVALID",
      "entry",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), runtime: "native" }, root),
      "CONFIG_INVALID",
      "config.runtime",
    );
  });

  test("resolves an exclusive Swift backend package", async () => {
    const root = await project();
    await mkdir(resolve(root, "Backend"));
    await writeFile(resolve(root, "Backend/Package.swift"), "// swift-tools-version: 6.0\n");
    await rm(resolve(root, "src/server.ts"));
    const config = await resolveProjectConfig({
      ...minimal(),
      runtime: "swift",
      swift: { package: "Backend", product: "HelloBackend" },
    }, root);
    expect(config).toMatchObject({
      runtime: "swift",
      swift: { package: resolve(root, "Backend"), product: "HelloBackend" },
    });
    expect(config.entry).toBeUndefined();

    await expectConfigError(
      resolveProjectConfig({ ...minimal(), runtime: "swift" }, root),
      "CONFIG_INVALID",
      "swift",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), swift: { package: "Backend", product: "HelloBackend" } }, root),
      "CONFIG_INVALID",
      "swift",
    );
    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        runtime: "swift",
        swift: { package: "Backend", product: "../unsafe" },
      }, root),
      "CONFIG_SWIFT_INVALID",
      "swift.product",
    );
    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        runtime: "swift",
        swift: { package: "Missing", product: "HelloBackend" },
      }, root),
      "CONFIG_SWIFT_INVALID",
      "swift.package",
    );

    const outsideRoot = await project();
    await mkdir(resolve(outsideRoot, "Backend"));
    await writeFile(resolve(outsideRoot, "Backend/Package.swift"), "// swift-tools-version: 6.0\n");
    await symlink(resolve(outsideRoot, "Backend"), resolve(root, "LinkedBackend"));
    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        runtime: "swift",
        swift: { package: "LinkedBackend", product: "HelloBackend" },
      }, root),
      "CONFIG_SWIFT_INVALID",
      "swift.package",
    );

    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        runtime: "swift",
        entry: "src/server.ts",
        swift: { package: "Backend", product: "HelloBackend" },
      }, root),
      "CONFIG_INVALID",
      "entry",
    );
  });

  test("loads a default TypeScript export from the project root", async () => {
    const root = await project();
    await writeFile(resolve(root, "fia.config.ts"), `
      export default {
        configVersion: 2,
        app: {
          name: "Loaded App",
          identifier: "com.example.loaded",
          version: "2.3.4",
          mode: "hybrid",
        },
        entry: "src/server.ts",
        window: {
          width: 900,
          height: 600,
          minWidth: 500,
          minHeight: 400,
          alwaysOnTop: true,
          visibleOnAllSpaces: true,
        },
        statusBar: { symbol: "bolt.fill", tooltip: "Loaded status" },
      };
    `);
    const config = await loadProjectConfig(root);
    expect(config.app).toEqual({
      name: "Loaded App",
      identifier: "com.example.loaded",
      version: "2.3.4",
      mode: "hybrid",
    });
    expect(config.window.width).toBe(900);
    expect(config.window.closeBehavior).toBe("hide");
    expect(config.window.alwaysOnTop).toBe(true);
    expect(config.statusBar).toEqual({ symbol: "bolt.fill", tooltip: "Loaded status" });
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
      resolveProjectConfig({ ...minimal(), configVersion: 1 }, root),
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

  test("validates phase 2 desktop modes, flags, and status bar values", async () => {
    const root = await project();
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), app: { name: "Hello", identifier: "com.example.hello", mode: "tray" } }, root),
      "CONFIG_INVALID",
      "app.mode",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), app: { name: "Hello", identifier: "com.example.hello", quitOnLastWindowClosed: true } }, root),
      "CONFIG_INVALID",
      "app.quitOnLastWindowClosed",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), window: { closeBehavior: "close" } }, root),
      "CONFIG_INVALID",
      "window.closeBehavior",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), window: { alwaysOnTop: "yes" } }, root),
      "CONFIG_INVALID",
      "window.alwaysOnTop",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), statusBar: { symbol: " invalid " } }, root),
      "CONFIG_INVALID",
      "statusBar.symbol",
    );
  });

  test("resolves a readable ICNS app icon inside the project", async () => {
    const root = await project();
    await writeFile(resolve(root, "icon.icns"), "test icon");
    const config = await resolveProjectConfig({
      ...minimal(),
      app: { name: "Hello", identifier: "com.example.hello", icon: "icon.icns" },
    }, root);
    expect(config.app.icon).toBe(resolve(root, "icon.icns"));
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

  test("requires a safe application name and UI file inside the project", async () => {
    const root = await project();
    const outsideRoot = await project();
    await symlink(resolve(outsideRoot, "src/ui/index.html"), resolve(root, "src/ui/linked.html"));
    for (const name of [" unsafe", "unsafe/child", "unsafe:name", ".", ".."]) {
      await expectConfigError(
        resolveProjectConfig({ ...minimal(), app: { name, identifier: "com.example.hello" } }, root),
        "CONFIG_INVALID",
        "app.name",
      );
    }
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), ui: "src/ui/missing.html" }, root),
      "CONFIG_UI_INVALID",
      "ui",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), ui: "src/ui/linked.html" }, root),
      "CONFIG_UI_INVALID",
      "ui",
    );
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), ui: "src/server.ts" }, root),
      "CONFIG_UI_INVALID",
      "ui",
    );
  });

  test("requires an ICNS icon inside the project", async () => {
    const root = await project();
    const outsideRoot = await project();
    await writeFile(resolve(root, "icon.png"), "not an icns");
    await writeFile(resolve(outsideRoot, "icon.icns"), "outside icon");
    await symlink(resolve(outsideRoot, "icon.icns"), resolve(root, "linked.icns"));
    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        app: { name: "Hello", identifier: "com.example.hello", icon: "icon.png" },
      }, root),
      "CONFIG_ICON_INVALID",
      "app.icon",
    );
    await expectConfigError(
      resolveProjectConfig({
        ...minimal(),
        app: { name: "Hello", identifier: "com.example.hello", icon: "linked.icns" },
      }, root),
      "CONFIG_ICON_INVALID",
      "app.icon",
    );
  });

  test("reports missing and unimportable config files without exposing implementation errors", async () => {
    const root = await project();
    await expectConfigError(loadProjectConfig(root), "CONFIG_NOT_FOUND");
    await writeFile(resolve(root, "fia.config.ts"), "export default { this is invalid };\n");
    await expectConfigError(loadProjectConfig(root), "CONFIG_IMPORT_FAILED");
  });
});
