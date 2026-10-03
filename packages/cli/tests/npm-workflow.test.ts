import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import cli from "../package.json";
import { hash } from "../src/artifacts.ts";
import { BUNDLED_BUN_VERSION, FIA_BACKEND_PROTOCOL_VERSION } from "../src/metadata.ts";
import { checkNPMRelease } from "../../../tools/check-npm-release.ts";
import { checkNPMPackage } from "../../../tools/check-npm-package.ts";

test("release metadata validates all version sources and routes prereleases to next", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-npm-metadata-"));
  const version = "1.2.3";
  const paths = [
    "package.json",
    "packages/cli/package.json",
    "packages/cli/src/metadata.ts",
    "Sources/FIACore/FIAVersion.swift",
    "bun.lock",
  ];
  try {
    for (const path of paths) {
      await mkdir(dirname(resolve(directory, path)), { recursive: true });
      const source = await readFile(resolve(import.meta.dir, "../../..", path), "utf8");
      await writeFile(
        resolve(directory, path),
        source.replaceAll(`"${cli.version}"`, `"${version}"`),
      );
    }
    expect(await checkNPMRelease(directory, `refs/tags/v${version}`)).toEqual({
      version,
      distTag: "latest",
    });
    await expect(checkNPMRelease(directory, "refs/tags/v99.0.0")).rejects.toThrow(
      "Release tag must be",
    );
    for (const path of paths) {
      const filename = resolve(directory, path);
      const source = await readFile(filename, "utf8");
      await writeFile(filename, source.replaceAll(`"${version}"`, '"99.0.0"'));
      await expect(checkNPMRelease(directory)).rejects.toThrow("does not match");
      await writeFile(filename, source);
    }
    const prerelease = `${version}-beta.1`;
    for (const path of paths) {
      const filename = resolve(directory, path);
      await writeFile(
        filename,
        (await readFile(filename, "utf8")).replaceAll(`"${version}"`, `"${prerelease}"`),
      );
    }
    expect(await checkNPMRelease(directory, `refs/tags/v${prerelease}`)).toEqual({
      version: prerelease,
      distTag: "next",
    });
    const packagePath = resolve(directory, "packages/cli/package.json");
    const source = await readFile(packagePath, "utf8");
    await writeFile(packagePath, source.replace("potato47/fia", "other/fia"));
    await expect(checkNPMRelease(directory)).rejects.toThrow("repository.url");
    await writeFile(packagePath, source.replace(prerelease, "01.2.3"));
    await expect(checkNPMRelease(directory)).rejects.toThrow("invalid semantic version");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("packed package validation rejects omitted SDK files, corrupt runtimes and lost executable bits", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-npm-package-"));
  const put = async (path: string, data: string | Uint8Array) => {
    await mkdir(dirname(resolve(directory, path)), { recursive: true });
    await writeFile(resolve(directory, path), data);
  };
  try {
    await put("package.json", JSON.stringify(cli));
    for (const path of [
      "dist/index.js",
      "dist/agent-cli.js",
      "dist/script-preload.js",
      "README.md",
      "docs/framework/README.md",
      "templates/assets/icon.icns",
      "templates/assets/icon.png",
      ...Object.values(cli.exports).flatMap((entry) => Object.values(entry)),
    ])
      await put(path, "fixture");
    await put("bin/fia", `console.log(${JSON.stringify(cli.version)});`);
    const binary = Buffer.alloc(8);
    binary.writeUInt32LE(0xfeedfacf, 0);
    binary.writeUInt32LE(0x0100000c, 4);
    await put("assets/darwin-arm64/FIAHost", binary);
    await put("assets/darwin-arm64/bun", binary);
    await put(
      "assets/darwin-arm64/manifest.json",
      JSON.stringify({
        schema: 1,
        frameworkVersion: cli.version,
        bunVersion: BUNDLED_BUN_VERSION,
        protocol: FIA_BACKEND_PROTOCOL_VERSION,
        architecture: "arm64",
        hostSHA256: hash(binary),
        bunSHA256: hash(binary),
      }),
    );
    for (const path of ["bin/fia", "assets/darwin-arm64/FIAHost", "assets/darwin-arm64/bun"])
      await chmod(resolve(directory, path), 0o755);
    await checkNPMPackage(directory);
    await rm(resolve(directory, "dist/client.d.ts"));
    await expect(checkNPMPackage(directory)).rejects.toThrow();
    await put("dist/client.d.ts", "fixture");
    await chmod(resolve(directory, "assets/darwin-arm64/FIAHost"), 0o644);
    await expect(checkNPMPackage(directory)).rejects.toThrow("executable bit");
    await chmod(resolve(directory, "assets/darwin-arm64/FIAHost"), 0o755);
    await put("assets/darwin-arm64/bun", "corrupt runtime");
    await expect(checkNPMPackage(directory)).rejects.toThrow("integrity failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
