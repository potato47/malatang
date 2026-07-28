import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, FIA_CONFIG_VERSION } from "../src/config.ts";
import {
  ProjectConfigError,
  resolveProjectConfig,
  type ProjectConfigErrorCode,
} from "../src/project-config.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-v3-"));
  temporaryDirectories.push(root);
  await mkdir(resolve(root, "src/ui"), { recursive: true });
  await mkdir(resolve(root, "src/mcp"), { recursive: true });
  await mkdir(resolve(root, "src/shared"), { recursive: true });
  await mkdir(resolve(root, "mcp"), { recursive: true });
  await writeFile(resolve(root, "src/ui/index.html"), "<div>test</div>\n");
  await writeFile(resolve(root, "src/mcp/server.ts"), "export {};\n");
  await writeFile(resolve(root, "mcp/search-server"), "#!/bin/sh\nexit 0\n");
  await chmod(resolve(root, "mcp/search-server"), 0o755);
  return root;
}

function minimal(): Record<string, unknown> {
  return {
    configVersion: 3,
    app: { name: "Hello", identifier: "com.example.hello" },
  };
}

async function expectConfigError(
  promise: Promise<unknown>,
  code: ProjectConfigErrorCode,
  path?: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected ProjectConfigError");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    expect((error as ProjectConfigError).code).toBe(code);
    if (path !== undefined) expect((error as ProjectConfigError).path).toBe(path);
  }
}

describe("FIA configVersion 3", () => {
  test("exports the modern configuration version", () => {
    const config = defineConfig({
      configVersion: FIA_CONFIG_VERSION,
      app: { name: "Hello", identifier: "com.example.hello" },
    });
    expect(config.app.name).toBe("Hello");
    expect(FIA_CONFIG_VERSION).toBe(3);
  });

  test("supports a pure UI application", async () => {
    const root = await project();
    const config = await resolveProjectConfig(minimal(), root);
    expect(config).toMatchObject({
      configVersion: 3,
      ui: resolve(root, "src/ui/index.html"),
      app: { name: "Hello", identifier: "com.example.hello", version: "0.1.0", mode: "dock" },
      window: { closeBehavior: "quit", restoreState: true },
      statusBar: { symbol: "circle.grid.2x2.fill", tooltip: "Hello" },
    });
    expect(config.mcp).toBeUndefined();
  });

  test("resolves the default Bun app server and explicit watch paths", async () => {
    const root = await project();
    const config = await resolveProjectConfig({
      ...minimal(),
      mcp: {
        app: {
          entry: "src/mcp/server.ts",
          watch: ["src/mcp", "src/shared"],
        },
      },
    }, root);
    expect(config.mcp?.app).toEqual({
      entry: resolve(root, "src/mcp/server.ts"),
      watch: [resolve(root, "src/mcp"), resolve(root, "src/shared")],
    });
    expect(config.mcp?.servers).toEqual({});

    const defaults = await resolveProjectConfig({
      ...minimal(),
      mcp: { app: { entry: "src/mcp/server.ts" } },
    }, root);
    expect(defaults.mcp?.app?.watch).toEqual([resolve(root, "src/mcp")]);
  });

  test("supports multiple project-contained executable servers", async () => {
    const root = await project();
    const config = await resolveProjectConfig({
      ...minimal(),
      mcp: {
        app: { entry: "src/mcp/server.ts" },
        servers: {
          search: { executable: "mcp/search-server", args: ["--stdio"] },
        },
      },
    }, root);
    expect(config.mcp?.servers.search).toEqual({
      executable: resolve(root, "mcp/search-server"),
      args: ["--stdio"],
    });
  });

  test("rejects reserved and malformed server IDs", async () => {
    const root = await project();
    for (const id of ["app", "fia.native", "fia.search", "Upper", "a..b"]) {
      await expectConfigError(resolveProjectConfig({
        ...minimal(),
        mcp: { servers: { [id]: { executable: "mcp/search-server" } } },
      }, root), "CONFIG_INVALID", `mcp.servers.${id}`);
    }
  });

  test("rejects traversal and symlink escape paths", async () => {
    const root = await project();
    const outside = await project();
    await symlink(resolve(outside, "mcp/search-server"), resolve(root, "mcp/linked"));
    await expectConfigError(resolveProjectConfig({
      ...minimal(),
      mcp: { servers: { search: { executable: "../outside" } } },
    }, root), "CONFIG_MCP_INVALID", "mcp.servers.search.executable");
    await expectConfigError(resolveProjectConfig({
      ...minimal(),
      mcp: { servers: { search: { executable: "mcp/linked" } } },
    }, root), "CONFIG_MCP_INVALID", "mcp.servers.search.executable");
  });

  test("rejects every removed legacy field and unknown nested fields", async () => {
    const root = await project();
    for (const field of ["runtime", "swift", "entry"]) {
      await expectConfigError(resolveProjectConfig({ ...minimal(), [field]: "legacy" }, root), "CONFIG_INVALID", field);
    }
    await expectConfigError(resolveProjectConfig({
      ...minimal(),
      mcp: { app: { entry: "src/mcp/server.ts", legacy: true } },
    }, root), "CONFIG_INVALID", "mcp.app.legacy");
    await expectConfigError(
      resolveProjectConfig({ ...minimal(), configVersion: 2 }, root),
      "CONFIG_UNSUPPORTED_VERSION",
      "configVersion",
    );
  });
});
