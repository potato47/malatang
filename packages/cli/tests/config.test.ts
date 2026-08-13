import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig, FIA_CONFIG_VERSION } from "../src/config.ts";
import { ProjectConfigError, resolveProjectConfig } from "../src/project-config.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-v5-"));
  temporaryDirectories.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/backend.ts"), "export default {};\n");
  await writeFile(resolve(root, "icon.icns"), "icon");
  return root;
}

function base() {
  return {
    configVersion: 5 as const,
    app: { name: "Desktop", identifier: "com.example.desktop" },
    backend: { entry: "src/backend.ts" },
  };
}

describe("FIA configVersion 5", () => {
  test("exports a strict defineConfig helper", () => {
    const value = defineConfig(base());
    expect(FIA_CONFIG_VERSION).toBe(5);
    expect(value.configVersion).toBe(5);
  });

  test("resolves required backend and defaults", async () => {
    const root = await project();
    const config = await resolveProjectConfig(base(), root);
    expect(config.backend.entry).toBe(resolve(root, "src/backend.ts"));
    expect(config.backend.watch).toEqual([resolve(root, "src")]);
    expect(config.app.version).toBe("0.1.0");
    expect(config.statusBar.symbol).toBe("circle.grid.2x2.fill");
    expect(config.statusBar.tooltip).toBe("Desktop");
    expect(config.signing).toBeUndefined();
  });

  test("resolves a strict code signing identity", async () => {
    const root = await project();
    const config = await resolveProjectConfig(
      { ...base(), signing: { identity: "Developer ID Application: Example (TEAMID)" } },
      root,
    );
    expect(config.signing).toEqual({
      identity: "Developer ID Application: Example (TEAMID)",
    });
    await expect(
      resolveProjectConfig({ ...base(), signing: { identity: "  Developer ID  " } }, root),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "signing.identity" });
    await expect(
      resolveProjectConfig({ ...base(), signing: { identity: "Mac Developer: Example" } }, root),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "signing.identity" });
    await expect(
      resolveProjectConfig(
        { ...base(), signing: { identity: "Developer ID", team: "TEAMID" } },
        root,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "signing.team" });
  });

  test("resolves explicit watch, icon and status item", async () => {
    const root = await project();
    const config = await resolveProjectConfig(
      {
        ...base(),
        app: { ...base().app, version: "1.2.3", icon: "icon.icns" },
        backend: { entry: "src/backend.ts", watch: ["src"] },
        statusBar: { symbol: "bolt.fill", tooltip: "Service" },
      },
      root,
    );
    expect(config.backend.watch).toEqual([resolve(root, "src")]);
    expect(config.app.icon).toBe(resolve(root, "icon.icns"));
    expect(config.statusBar).toEqual({ symbol: "bolt.fill", tooltip: "Service" });
  });

  test("rejects all legacy architecture fields without compatibility", async () => {
    const root = await project();
    for (const [field, value] of [
      ["ui", "src/ui/index.html"],
      ["window", {}],
      ["mcp", {}],
      ["runtime", {}],
    ] as const) {
      await expect(resolveProjectConfig({ ...base(), [field]: value }, root)).rejects.toMatchObject(
        {
          code: "CONFIG_INVALID",
          path: field,
        },
      );
    }
    await expect(resolveProjectConfig({ ...base(), configVersion: 4 }, root)).rejects.toMatchObject(
      {
        code: "CONFIG_UNSUPPORTED_VERSION",
      },
    );
  });

  test("requires safe accessible project paths", async () => {
    const root = await project();
    await expect(
      resolveProjectConfig({ ...base(), backend: { entry: "../outside.ts" } }, root),
    ).rejects.toBeInstanceOf(ProjectConfigError);
    await expect(
      resolveProjectConfig({ ...base(), backend: { entry: "missing.ts" } }, root),
    ).rejects.toMatchObject({ code: "CONFIG_BACKEND_INVALID" });
  });
});
