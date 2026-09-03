import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(resolve(tmpdir(), "fia-config-v6-"));
  temporaryDirectories.push(root);
  await mkdir(resolve(root, "src"));
  await mkdir(resolve(root, "native"));
  await writeFile(resolve(root, "src/backend.ts"), "export default {};\n");
  await writeFile(resolve(root, "icon.icns"), "icon");
  await writeFile(resolve(root, "native/AIXHost"), "host");
  await writeFile(resolve(root, "native/aix"), "helper");
  await chmod(resolve(root, "native/AIXHost"), 0o755);
  await chmod(resolve(root, "native/aix"), 0o755);
  return root;
}

function base() {
  return {
    configVersion: 6 as const,
    app: { name: "Desktop", identifier: "com.example.desktop" },
    backend: { entry: "src/backend.ts" },
  };
}

describe("FIA configVersion 6", () => {
  test("exports a strict defineConfig helper", () => {
    const value = defineConfig(base());
    expect(FIA_CONFIG_VERSION).toBe(6);
    expect(value.configVersion).toBe(6);
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
    expect(config.release).toBeUndefined();
    expect(config.host).toBeUndefined();
    expect(config.helpers).toEqual([]);
  });

  test("resolves one custom Host and deterministic native helpers", async () => {
    const root = await project();
    const config = await resolveProjectConfig(
      {
        ...base(),
        host: { executable: "native/AIXHost", name: "AIXHost" },
        helpers: [{ executable: "native/aix", name: "aix" }],
      },
      root,
    );
    expect(config.host).toEqual({
      executable: resolve(root, "native/AIXHost"),
      name: "AIXHost",
    });
    expect(config.helpers).toEqual([{ executable: resolve(root, "native/aix"), name: "aix" }]);
  });

  test("rejects unsafe, duplicate, reserved, and non-executable native artifacts", async () => {
    const root = await project();
    await expect(
      resolveProjectConfig(
        {
          ...base(),
          helpers: [
            { executable: "native/aix", name: "aix" },
            { executable: "native/aix", name: "aix" },
          ],
        },
        root,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "helpers.1.name" });
    await expect(
      resolveProjectConfig(
        {
          ...base(),
          helpers: [{ executable: "native/aix", name: "FIABackend" }],
        },
        root,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "helpers.0.name" });
    await expect(
      resolveProjectConfig(
        {
          ...base(),
          host: { executable: "native/AIXHost", name: "../AIXHost" },
        },
        root,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "host.name" });
    await chmod(resolve(root, "native/aix"), 0o644);
    await expect(
      resolveProjectConfig(
        {
          ...base(),
          helpers: [{ executable: "native/aix", name: "aix" }],
        },
        root,
      ),
    ).rejects.toMatchObject({
      code: "CONFIG_NATIVE_ARTIFACT_INVALID",
      path: "helpers.0.executable",
    });
  });

  test("resolves strict Developer ID release and notarization settings", async () => {
    const root = await project();
    const config = await resolveProjectConfig(
      {
        ...base(),
        release: {
          identity: "Developer ID Application: Example (TEAMID)",
          notarization: { keychainProfile: "fia-notary" },
        },
      },
      root,
    );
    expect(config.release).toEqual({
      identity: "Developer ID Application: Example (TEAMID)",
      notarization: { keychainProfile: "fia-notary" },
    });
    await expect(
      resolveProjectConfig(
        { ...base(), release: { identity: "Apple Development: Example (TEAMID)" } },
        root,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_INVALID", path: "release.identity" });
    await expect(
      resolveProjectConfig(
        {
          ...base(),
          release: {
            identity: "Developer ID Application: Example (TEAMID)",
            notarization: { keychainProfile: " fia-notary " },
          },
        },
        root,
      ),
    ).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      path: "release.notarization.keychainProfile",
    });
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
    await expect(resolveProjectConfig({ ...base(), configVersion: 5 }, root)).rejects.toMatchObject(
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
