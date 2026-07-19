import { afterEach, describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import { CLI_VERSION } from "../src/metadata.ts";

const packageRoot = resolve(import.meta.dir, "..");
const executable = resolve(packageRoot, "bin/fia");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function run(arguments_: readonly string[], cwd = packageRoot): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn([process.execPath, executable, ...arguments_], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("published CLI shape", () => {
  test("keeps package metadata and runtime version aligned", () => {
    expect(packageMetadata.name).toBe("@semicoder/fia");
    expect(packageMetadata.version).toBe(CLI_VERSION);
    expect(packageMetadata.bin).toEqual({ fia: "bin/fia" });
    expect(packageMetadata.exports).toEqual({
      "./config": {
        types: "./dist/config.d.ts",
        import: "./dist/config.js",
        default: "./dist/config.js",
      },
      "./runtime": {
        types: "./dist/runtime.d.ts",
        import: "./dist/runtime.js",
        default: "./dist/runtime.js",
      },
      "./native": {
        types: "./dist/native.d.ts",
        import: "./dist/native.js",
        default: "./dist/native.js",
      },
    });
    expect(packageMetadata.files).toContain("templates");
    expect(packageMetadata.files).toContain("assets");
    expect(packageMetadata.publishConfig).toEqual({ access: "public" });
  });

  test("runs the built bin for version and JSON diagnostics", async () => {
    expect(await Bun.file(resolve(packageRoot, "dist/index.js")).exists()).toBe(true);

    const version = await run(["--version"]);
    const doctor = await run(["doctor", "--json"]);

    expect(version).toEqual({ exitCode: 0, stdout: `fia ${CLI_VERSION}\n`, stderr: "" });
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stderr).toBe("");
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      schemaVersion: 1,
      cli: { name: "@semicoder/fia", version: CLI_VERSION },
      ok: true,
    });
  });

  test("publishes the config entry and templates used by the built CLI", async () => {
    expect(await Bun.file(resolve(packageRoot, "dist/config.js")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/config.d.ts")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/runtime.js")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/runtime.d.ts")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/native.js")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/native.d.ts")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "dist/managed-runtime.js")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "assets/host/darwin-arm64/FIAHost")).exists()).toBe(true);
    expect(await Bun.file(resolve(packageRoot, "assets/host/darwin-arm64/manifest.json")).exists()).toBe(true);
    const host = resolve(packageRoot, "assets/host/darwin-arm64/FIAHost");
    await access(host, constants.X_OK);
    const manifest = JSON.parse(await readFile(
      resolve(packageRoot, "assets/host/darwin-arm64/manifest.json"),
      "utf8",
    )) as { sha256: string; configurationSchemas: number[]; runtimeProtocol: number };
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(host).arrayBuffer());
    expect(manifest).toMatchObject({ configurationSchemas: [1, 2, 3], runtimeProtocol: 1 });
    expect(hasher.digest("hex")).toBe(manifest.sha256);
    expect(await Bun.file(resolve(packageRoot, "templates/react/src/server.ts.template")).exists()).toBe(true);

    const configModule = await import(`../dist/config.js?test=${crypto.randomUUID()}`) as {
      FIA_CONFIG_VERSION: number;
      defineConfig<T>(value: T): T;
    };
    expect(configModule.FIA_CONFIG_VERSION).toBe(2);
    expect(configModule.defineConfig({ configVersion: 2 })).toEqual({ configVersion: 2 });

    const cwd = await mkdtemp(resolve(tmpdir(), "fia-built-cli-"));
    temporaryDirectories.push(cwd);
    const result = await run(["create", "built-project", "--no-install"], cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(await Bun.file(resolve(cwd, "built-project/src/ui/App.tsx")).exists()).toBe(true);
  });
});
