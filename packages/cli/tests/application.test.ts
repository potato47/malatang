import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeApplicationCommand, type ApplicationProcessRunner } from "../src/application.ts";
import { createProject } from "../src/create.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("Swift-first application build", () => {
  test("rejects Browser Companion for a project without Web Runtime", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-browser-native-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "native-only",
      cwd,
      install: false,
      initializeGit: false,
      template: "native",
      backend: false,
      io: { stdout() {} },
    });
    await expect(
      executeApplicationCommand({
        command: "dev",
        browser: "chrome",
        cwd: root,
        debug: false,
        io: { stdout() {}, stderr() {} },
        dependencies: {
          runner: async () => {
            throw new Error("build must not start");
          },
        },
      }),
    ).rejects.toThrow("Browser Companion requires [web].enabled = true");
  });

  test("assembles the app from FIAAppExecutable without a Host or Bun helper", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-build-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "build-app",
      cwd,
      install: false,
      initializeGit: false,
      template: "web",
      backend: false,
      io: { stdout() {} },
    });
    const commands: readonly string[][] = [];
    const mutable = commands as string[][];
    const runner: ApplicationProcessRunner = async (command) => {
      mutable.push([...command]);
      if (command.includes("vite")) {
        await mkdir(resolve(root, "frontend/dist"), { recursive: true });
        await writeFile(resolve(root, "frontend/dist/index.html"), "ok");
      }
      if (command.includes("swift")) {
        const executable = resolve(
          root,
          ".fia/swift-build/arm64-apple-macosx/release/FIAAppExecutable",
        );
        await mkdir(resolve(executable, ".."), { recursive: true });
        await writeFile(executable, "#!/bin/sh\nexit 0\n");
        await chmod(executable, 0o755);
      }
      return { exitCode: 0 };
    };
    const stdout: string[] = [];
    await executeApplicationCommand({
      command: "build",
      cwd: root,
      debug: false,
      io: { stdout: (value) => stdout.push(value), stderr() {} },
      dependencies: { runner },
    });
    const app = resolve(root, "dist/Build App.app");
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIAAppExecutable")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIAHost")).exists()).toBe(false);
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIABunBackend")).exists()).toBe(false);
    expect(await Bun.file(resolve(app, "Contents/Resources/web/index.html")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/Info.plist")).text()).not.toContain("LSUIElement");
    expect(stdout[0]).toContain("Build App.app");
  });

  test("releases the selected channel with Sparkle signature evidence", async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), "fia-release-v2-"));
    roots.push(cwd);
    const root = await createProject({
      name: "release-app",
      cwd,
      install: false,
      initializeGit: false,
      template: "native",
      backend: false,
      io: { stdout() {} },
    });
    const expectedSignature = Buffer.alloc(64, 2).toString("base64");
    const configPath = resolve(root, "fia.toml");
    await writeFile(
      configPath,
      `${await readFile(configPath, "utf8")}
[updater]
publicKey = "${Buffer.alloc(32, 1).toString("base64")}"
channel = "stable"
ui = "native"

[updater.feeds]
stable = "https://updates.example.dev/stable.xml"
beta = "https://updates.example.dev/beta.xml"

[signing]
releaseIdentity = "Developer ID Application: Example (TEAMID1234)"
notarizationProfile = "fia-notary"
`,
    );
    const runner: ApplicationProcessRunner = async (command) => {
      if (command.includes("swift")) {
        const executable = resolve(
          root,
          ".fia/swift-build/arm64-apple-macosx/release/FIAAppExecutable",
        );
        await mkdir(resolve(executable, ".."), { recursive: true });
        await writeFile(executable, "#!/bin/sh\nexit 0\n");
        await chmod(executable, 0o755);
        const sparkle = resolve(root, ".fia/swift-build/artifacts/fia/Sparkle.framework");
        await Promise.all([
          mkdir(resolve(sparkle, "Downloader.xpc"), { recursive: true }),
          mkdir(resolve(sparkle, "Installer.xpc"), { recursive: true }),
          mkdir(resolve(sparkle, "Updater.app"), { recursive: true }),
        ]);
        await writeFile(resolve(sparkle, "Autoupdate"), "helper");
        const appcastTool = resolve(root, ".fia/swift-build/artifacts/fia/generate_appcast");
        await writeFile(appcastTool, "tool");
      }
      if (command[0] === "/usr/bin/ditto") {
        await writeFile(command.at(-1)!, "archive");
      }
      if (command[0]?.endsWith("generate_appcast") === true) {
        const archiveName = "Release App-0.1.0-1-mac-arm64.zip";
        const oldSignature = Buffer.alloc(64, 3).toString("base64");
        await writeFile(
          resolve(command[1]!, "appcast.xml"),
          `<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><enclosure url="https://updates.example.dev/old.zip" sparkle:edSignature="${oldSignature}"/><enclosure url="https://updates.example.dev/${encodeURIComponent(archiveName)}" sparkle:edSignature="${expectedSignature}"/></rss>`,
        );
      }
      return { exitCode: 0 };
    };
    await executeApplicationCommand({
      command: "release",
      channel: "beta",
      cwd: root,
      debug: false,
      io: { stdout() {}, stderr() {} },
      dependencies: { runner },
    });

    const releaseDirectory = resolve(root, "dist/updates/beta");
    const archive = resolve(releaseDirectory, "Release App-0.1.0-1-mac-arm64.zip");
    expect(await readFile(`${archive}.ed25519`, "utf8")).toBe(`${expectedSignature}\n`);
    expect(
      await readFile(resolve(root, "dist/Release App.app/Contents/Info.plist"), "utf8"),
    ).toContain("https://updates.example.dev/beta.xml");
    const report = JSON.parse(
      await readFile(resolve(releaseDirectory, "release-report.json"), "utf8"),
    ) as { channel: string; ed25519Signature: string };
    expect(report.channel).toBe("beta");
    expect(report.ed25519Signature).toBe(`${archive}.ed25519`);
  });
});
