import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_PACKAGE_NAME } from "./metadata.ts";

export interface LocalFramework {
  root: string;
  cliPackageDirectory: string;
}

export async function validateLocalFramework(root: string): Promise<LocalFramework> {
  try {
    const directory = await realpath(root);
    const cliPackageDirectory = resolve(directory, "packages/cli");
    const [metadata, manifest, sources, entry] = await Promise.all([
      readFile(resolve(cliPackageDirectory, "package.json"), "utf8"),
      readFile(resolve(directory, "Package.swift"), "utf8"),
      stat(resolve(directory, "Sources/FIA")),
      stat(resolve(cliPackageDirectory, "src/index.ts")),
    ]);
    if (
      JSON.parse(metadata).name !== CLI_PACKAGE_NAME ||
      !/\.library\(\s*name:\s*"FIA"/u.test(manifest) ||
      !sources.isDirectory() ||
      !entry.isFile()
    ) {
      throw new Error("FIA package metadata or sources are missing");
    }
    return { root: directory, cliPackageDirectory };
  } catch (cause) {
    throw new Error(
      `Invalid local FIA checkout at ${root}: expected Package.swift with the FIA library, Sources/FIA, and packages/cli sources`,
      { cause },
    );
  }
}

export async function resolveLocalFramework(
  cliPackageDirectory = resolve(import.meta.dir, ".."),
): Promise<LocalFramework> {
  try {
    // Resolve the package symlink before walking up to the source checkout.
    return await validateLocalFramework(resolve(await realpath(cliPackageDirectory), "../.."));
  } catch (cause) {
    throw new Error(
      "--local requires running FIA from a source checkout. Run bun run cli:build in the FIA repository, then bun link in packages/cli and retry with the linked fia command.",
      { cause },
    );
  }
}

export async function validateLocalFrameworkLink(
  projectRoot: string,
  framework: LocalFramework,
): Promise<void> {
  let installed: string;
  try {
    installed = await realpath(resolve(projectRoot, "node_modules", CLI_PACKAGE_NAME));
  } catch (cause) {
    throw new Error(
      `Local ${CLI_PACKAGE_NAME} is not installed. Run bun link in ${framework.cliPackageDirectory}, then bun install in the application`,
      { cause },
    );
  }
  if (installed !== framework.cliPackageDirectory) {
    throw new Error(
      `Local ${CLI_PACKAGE_NAME} resolves to ${installed}, but Swift uses ${framework.root}. Run bun link in ${framework.cliPackageDirectory}, then reinstall the application's dependencies`,
    );
  }
}
