import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import cliPackage from "../packages/cli/package.json";
import { repositoryRoot, requireBunVersion, run } from "./shared.ts";

const PACKAGE_PATH = resolve(repositoryRoot, "packages/cli/package.json");
const METADATA_PATH = resolve(repositoryRoot, "packages/cli/src/metadata.ts");
const LOCK_PATH = resolve(repositoryRoot, "bun.lock");
const HOST_PATH = resolve(repositoryRoot, "packages/cli/assets/host/darwin-arm64/FIAHost");
const HOST_MANIFEST_PATH = resolve(repositoryRoot, "packages/cli/assets/host/darwin-arm64/manifest.json");
const VERSIONED_PATHS = [PACKAGE_PATH, METADATA_PATH, LOCK_PATH, HOST_PATH, HOST_MANIFEST_PATH] as const;

const help = `Update the @semicoder/fia release version

Usage:
  bun run version:npm -- <version>

Example:
  bun run version:npm -- 0.3.0

The command requires a clean Git working tree, updates package and CLI metadata, refreshes bun.lock,
rebuilds the embedded arm64 Host, and rolls back all versioned files if any step fails.
`;

export interface VersionArguments {
  readonly help: boolean;
  readonly version?: string;
}

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

interface HostManifest {
  readonly cliVersion: string;
  readonly hostVersion: string;
  readonly sha256: string;
}

interface Snapshot {
  readonly path: string;
  readonly contents: Uint8Array;
}

export function parseVersionArguments(arguments_: readonly string[]): VersionArguments {
  if (arguments_.length === 1 && (arguments_[0] === "-h" || arguments_[0] === "--help")) {
    return { help: true };
  }
  if (arguments_.some((argument) => argument.startsWith("-"))) {
    throw new Error(`unknown option: ${arguments_.find((argument) => argument.startsWith("-"))}`);
  }
  if (arguments_.length !== 1) throw new Error("exactly one target version is required");
  return { help: false, version: arguments_[0]! };
}

function parseVersion(value: string): ParsedVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (match === null) throw new Error(`invalid semantic version: ${value}`);
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"))) {
    throw new Error(`invalid semantic version: ${value}`);
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease,
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    if (left.length !== right.length) return left.length - right.length;
    return left.localeCompare(right);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    const difference = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function requireIncreasingVersion(current: string, target: string): void {
  parseVersion(current);
  parseVersion(target);
  if (compareSemanticVersions(target, current) <= 0) {
    throw new Error(`target version ${target} must be greater than current version ${current}`);
  }
}

export function readMetadataVersion(source: string): string {
  const matches = [...source.matchAll(/export const CLI_VERSION = "([^"]+)";/g)];
  if (matches.length !== 1) throw new Error("CLI metadata must contain exactly one CLI_VERSION declaration");
  return matches[0]![1]!;
}

export function replaceMetadataVersion(source: string, current: string, target: string): string {
  if (readMetadataVersion(source) !== current) {
    throw new Error(`CLI metadata does not match package version ${current}`);
  }
  return source.replace(
    `export const CLI_VERSION = "${current}";`,
    `export const CLI_VERSION = "${target}";`,
  );
}

export function readWorkspaceVersionFromLock(source: string): string {
  const start = source.indexOf('"packages/cli":');
  const remaining = start < 0 ? "" : source.slice(start);
  const packagesSection = /\n\s*"packages"\s*:/.exec(remaining);
  if (start < 0 || packagesSection?.index === undefined) {
    throw new Error("bun.lock does not contain the CLI workspace");
  }
  const end = start + packagesSection.index;
  const match = /"version":\s*"([^"]+)"/.exec(source.slice(start, end));
  if (match === null) throw new Error("bun.lock CLI workspace does not contain a version");
  return match[1]!;
}

export function replaceLockVersion(source: string, current: string, target: string): string {
  if (readWorkspaceVersionFromLock(source) !== current) {
    throw new Error(`bun.lock workspace version does not match package version ${current}`);
  }
  const start = source.indexOf('"packages/cli":');
  const remaining = source.slice(start);
  const packagesSection = /\n\s*"packages"\s*:/.exec(remaining);
  const end = start + packagesSection!.index;
  const block = source.slice(start, end);
  const replaced = block.replace(`"version": "${current}"`, `"version": "${target}"`);
  return source.slice(0, start) + replaced + source.slice(end);
}

async function requireCleanWorkingTree(): Promise<void> {
  const status = (await run(
    ["git", "status", "--porcelain", "--untracked-files=all"],
    { quiet: true },
  )).trim();
  if (status.length > 0) {
    throw new Error(`version changes require a clean Git working tree:\n${status}`);
  }
}

async function snapshotFiles(): Promise<Snapshot[]> {
  return await Promise.all(VERSIONED_PATHS.map(async (path) => ({ path, contents: await readFile(path) })));
}

async function restoreFiles(snapshots: readonly Snapshot[]): Promise<void> {
  await Promise.all(snapshots.map((snapshot) => writeFile(snapshot.path, snapshot.contents)));
}

async function writeVersionSources(current: string, target: string): Promise<void> {
  const packageSource = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as Record<string, unknown>;
  if (packageSource.version !== current) throw new Error("package version changed during the version update");
  packageSource.version = target;
  const metadataSource = await readFile(METADATA_PATH, "utf8");
  const lockSource = await readFile(LOCK_PATH, "utf8");
  await Promise.all([
    writeFile(PACKAGE_PATH, `${JSON.stringify(packageSource, null, 2)}\n`, "utf8"),
    writeFile(METADATA_PATH, replaceMetadataVersion(metadataSource, current, target), "utf8"),
    writeFile(LOCK_PATH, replaceLockVersion(lockSource, current, target), "utf8"),
  ]);
}

async function validateVersionedFiles(target: string): Promise<void> {
  const packageSource = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as { version?: string };
  const metadataVersion = readMetadataVersion(await readFile(METADATA_PATH, "utf8"));
  const lockVersion = readWorkspaceVersionFromLock(await readFile(LOCK_PATH, "utf8"));
  const manifest = JSON.parse(await readFile(HOST_MANIFEST_PATH, "utf8")) as HostManifest;
  await access(HOST_PATH, constants.R_OK | constants.X_OK);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(HOST_PATH).arrayBuffer());
  if (
    packageSource.version !== target
    || metadataVersion !== target
    || lockVersion !== target
    || manifest.cliVersion !== target
    || manifest.hostVersion !== target
    || manifest.sha256 !== hasher.digest("hex")
  ) {
    throw new Error(`generated release metadata is not consistently versioned as ${target}`);
  }
}

export async function updateNPMVersion(target: string): Promise<void> {
  requireBunVersion();
  const current = cliPackage.version;
  requireIncreasingVersion(current, target);
  const metadataVersion = readMetadataVersion(await readFile(METADATA_PATH, "utf8"));
  if (metadataVersion !== current) {
    throw new Error(`package version ${current} does not match CLI metadata ${metadataVersion}`);
  }
  await requireCleanWorkingTree();
  const snapshots = await snapshotFiles();

  try {
    process.stdout.write(`\n[version 1/4] Update ${current} to ${target}\n`);
    await writeVersionSources(current, target);
    process.stdout.write("\n[version 2/4] Refresh bun.lock\n");
    await run([process.execPath, "install", "--lockfile-only"]);
    process.stdout.write("\n[version 3/4] Rebuild the embedded Host\n");
    await run([process.execPath, "run", "host:package"]);
    process.stdout.write("\n[version 4/4] Validate synchronized release metadata\n");
    await validateVersionedFiles(target);
  } catch (error) {
    try {
      await restoreFiles(snapshots);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "version update failed and rollback was incomplete");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`version update failed; versioned files were rolled back: ${detail}`, { cause: error });
  }

  process.stdout.write(`\nPrepared @semicoder/fia@${target}. Next run:\n`);
  process.stdout.write("  bun run release:npm --dry-run\n");
  process.stdout.write("  git add packages/cli/package.json packages/cli/src/metadata.ts bun.lock packages/cli/assets/host\n");
  process.stdout.write(`  git commit -m "release: v${target}"\n`);
  process.stdout.write("  bun run release:npm\n");
}

async function main(): Promise<void> {
  const arguments_ = parseVersionArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(help);
    return;
  }
  await updateNPMVersion(arguments_.version!);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`version:npm: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
