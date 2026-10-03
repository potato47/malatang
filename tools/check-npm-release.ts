import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BUNDLED_BUN_VERSION, CLI_PACKAGE_NAME } from "../packages/cli/src/metadata.ts";
import { repositoryRoot } from "./shared.ts";
import {
  compareSemanticVersions,
  readMetadataVersion,
  readSwiftFrameworkVersion,
  readWorkspaceVersionFromLock,
} from "./version-npm.ts";

export async function checkNPMRelease(directory = repositoryRoot, ref?: string) {
  const read = (path: string) => readFile(resolve(directory, path), "utf8");
  const cli = JSON.parse(await read("packages/cli/package.json"));
  if (cli.name !== CLI_PACKAGE_NAME || cli.private === true)
    throw new Error("Expected the public @semicoder/fia package");
  if (cli.repository?.url !== "git+https://github.com/potato47/fia.git")
    throw new Error("npm repository.url must match potato47/fia for trusted publishing");
  const version: string = cli.version;
  compareSemanticVersions(version, version);
  const versions = {
    "package.json": JSON.parse(await read("package.json")).version,
    "packages/cli/src/metadata.ts": readMetadataVersion(await read("packages/cli/src/metadata.ts")),
    "Sources/FIACore/FIAVersion.swift": readSwiftFrameworkVersion(
      await read("Sources/FIACore/FIAVersion.swift"),
    ),
    "bun.lock": readWorkspaceVersionFromLock(await read("bun.lock")),
  };
  for (const [path, value] of Object.entries(versions))
    if (value !== version) throw new Error(`${path} version ${value} does not match ${version}`);
  if (ref?.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`)
    throw new Error(`Release tag must be v${version}; received ${ref}`);
  return { version, distTag: version.includes("-") ? "next" : "latest" };
}

if (import.meta.main) {
  try {
    if (Bun.version !== BUNDLED_BUN_VERSION)
      throw new Error(`Release requires Bun ${BUNDLED_BUN_VERSION}; found ${Bun.version}`);
    const { version, distTag } = await checkNPMRelease(repositoryRoot, process.env.GITHUB_REF);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ndist-tag=${distTag}\n`);
    console.log(`release: ${CLI_PACKAGE_NAME}@${version} → ${distTag}`);
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
