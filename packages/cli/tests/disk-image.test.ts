import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { packageDiskImage, type ApplicationProcessRunner } from "../src/application.ts";
import { sha256 } from "../src/artifacts.ts";
import { validateConfig } from "../src/project-config.ts";

for (const failure of ["none", "notarytool", "stapler", "smoke"] as const) {
  test(`DMG release preserves previous artifacts and cleans up on ${failure}`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-dmg-test-"));
    const commands: string[][] = [];
    let smokeCalled = false;
    const config = validateConfig(
      {
        app: { name: "Test App", identifier: "test.dmg", version: "1.0.0", build: 1 },
        agent: { command: "test-dmg", description: "Test" },
        signing: {
          releaseIdentity: "Developer ID Application: Test (TEAM)",
          notarizationProfile: "test",
        },
      },
      root,
    );
    const app = resolve(root, "dist/Test App.app");
    const dmg = resolve(root, "dist/Test App-1.0.0-1-mac-arm64.dmg");
    const runner: ApplicationProcessRunner = async (command) => {
      commands.push([...command]);
      if (command.includes(failure)) return { exitCode: 1, stdout: "", stderr: "rejected" };
      if (command[0] === "/usr/bin/ditto") await cp(command[1]!, command[2]!, { recursive: true });
      if (command[0] === "/usr/bin/hdiutil" && command[1] === "create")
        await writeFile(command.at(-1)!, "disk image contents");
      if (command[0] === "/usr/bin/hdiutil" && command[1] === "attach")
        await cp(
          resolve(dirname(command.at(-1)!), "payload"),
          command[command.indexOf("-mountpoint") + 1]!,
          { recursive: true, verbatimSymlinks: true },
        );
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    try {
      await mkdir(app, { recursive: true });
      await writeFile(resolve(app, "payload"), "application contents");
      await writeFile(dmg, "previous good image");
      const result = packageDiskImage(config, app, {
        distribution: true,
        runner,
        smoke: async (_config, mountedApp) => {
          smokeCalled = true;
          expect(await readFile(resolve(mountedApp!, "payload"), "utf8")).toBe(
            "application contents",
          );
          if (failure === "smoke") throw new Error("smoke failed");
          return {
            schemaVersion: 1,
            ok: true,
            application: mountedApp!,
            checks: [],
            runtime: {},
            desktopInteraction: "not-tested",
            logs: "",
          };
        },
      });
      if (failure === "none") {
        expect((await result).dmg).toBe(dmg);
        expect(await readFile(dmg + ".sha256", "utf8")).toStartWith(await sha256(dmg));
        expect(JSON.parse(await readFile(dmg + ".report.json", "utf8")).ok).toBe(true);
      } else {
        await expect(result).rejects.toThrow(failure === "smoke" ? "smoke failed" : "rejected");
        expect(await readFile(dmg, "utf8")).toBe("previous good image");
        expect(await Bun.file(dmg + ".sha256").exists()).toBe(false);
        expect(await Bun.file(dmg + ".report.json").exists()).toBe(false);
      }
      expect(smokeCalled).toBe(failure === "none" || failure === "smoke");
      const attached = commands.some((c) => c[1] === "attach");
      expect(commands.some((c) => c[1] === "detach")).toBe(attached);
      expect((await readdir(resolve(root, "dist"))).some((name) => name.startsWith(".dmg-"))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
