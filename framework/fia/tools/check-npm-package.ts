import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import cli from "../packages/cli/package.json";
import { verifyAssets } from "../packages/cli/src/artifacts.ts";
import { run } from "./shared.ts";

// Check the extracted tarball, so npm's files/ignore rules are part of validation.
export async function checkNPMPackage(directory: string): Promise<void> {
  const packaged = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (packaged.name !== cli.name || packaged.version !== cli.version)
    throw new Error("Packed npm identity does not match the source package");
  if (JSON.stringify(packaged.repository) !== JSON.stringify(cli.repository))
    throw new Error("Packed npm repository metadata does not match the source package");
  const required = [
    "bin/fia",
    "dist/index.js",
    "dist/agent-cli.js",
    "dist/script-preload.js",
    "README.md",
    "docs/framework/README.md",
    "templates/assets/icon.icns",
    "templates/assets/icon.png",
    ...Object.values(cli.exports).flatMap((entry) => Object.values(entry)),
  ];
  for (const path of new Set(required)) {
    const file = await lstat(resolve(directory, path));
    if (!file.isFile() || file.size === 0)
      throw new Error(`Missing or empty package file: ${path}`);
  }
  await verifyAssets(resolve(directory, "assets/darwin-arm64"));
  for (const path of ["bin/fia", "assets/darwin-arm64/FIAHost", "assets/darwin-arm64/bun"])
    if (!((await lstat(resolve(directory, path))).mode & 0o111))
      throw new Error(`Package executable bit is missing: ${path}`);
  const version = await run([process.execPath, resolve(directory, "bin/fia"), "--version"], {
    quiet: true,
  });
  if (version.trim() !== cli.version)
    throw new Error(`Packed CLI reported unexpected version: ${version}`);
}

if (import.meta.main) {
  try {
    const directory = process.argv[2];
    if (!directory || process.argv.length !== 3)
      throw new Error("Usage: bun tools/check-npm-package.ts <extracted-package-directory>");
    await checkNPMPackage(resolve(directory));
    console.log("release: packed CLI, SDK, docs, template and native runtimes verified");
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
