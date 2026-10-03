import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import cliPackage from "../packages/cli/package.json";
import { repositoryRoot, requireBunVersion, run } from "./shared.ts";

const PACKAGE_PATH = resolve(repositoryRoot, "packages/cli/package.json");
const ROOT_PACKAGE_PATH = resolve(repositoryRoot, "package.json");
const METADATA_PATH = resolve(repositoryRoot, "packages/cli/src/metadata.ts");
const SWIFT_VERSION_PATH = resolve(repositoryRoot, "Sources/FIACore/FIAVersion.swift");
const LOCK_PATH = resolve(repositoryRoot, "bun.lock");
const VERSIONED_PATHS = [
  PACKAGE_PATH,
  ROOT_PACKAGE_PATH,
  METADATA_PATH,
  SWIFT_VERSION_PATH,
  LOCK_PATH,
] as const;

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[];
}
interface Snapshot {
  readonly path: string;
  readonly contents: Uint8Array;
}

function parseVersion(value: string): ParsedVersion {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      value,
    );
  if (match === null) throw new Error(`invalid semantic version: ${value}`);
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new Error(`invalid semantic version: ${value}`);
  }
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left),
    rightNumber = /^\d+$/.test(right);
  if (leftNumber && rightNumber) return Number(left) - Number(right);
  if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
  return left.localeCompare(right);
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number {
  const left = parseVersion(leftValue),
    right = parseVersion(rightValue);
  for (let index = 0; index < 3; index += 1) {
    const difference = left.core[index]! - right.core[index]!;
    if (difference !== 0) return difference;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const leftPart = left.prerelease[index],
      rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    const difference = compareIdentifier(leftPart, rightPart);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function requireIncreasingVersion(current: string, target: string): void {
  parseVersion(current);
  parseVersion(target);
  if (compareSemanticVersions(target, current) <= 0)
    throw new Error(`target version ${target} must be greater than current version ${current}`);
}

export function readMetadataVersion(source: string): string {
  const matches = [...source.matchAll(/export const CLI_VERSION = "([^"]+)";/g)];
  if (matches.length !== 1)
    throw new Error("CLI metadata must contain exactly one CLI_VERSION declaration");
  return matches[0]![1]!;
}

export function replaceMetadataVersion(source: string, current: string, target: string): string {
  if (readMetadataVersion(source) !== current)
    throw new Error(`CLI metadata does not match package version ${current}`);
  return source.replace(
    `export const CLI_VERSION = "${current}";`,
    `export const CLI_VERSION = "${target}";`,
  );
}

export function readSwiftFrameworkVersion(source: string): string {
  const matches = [...source.matchAll(/public static let current = "([^"]+)"/g)];
  if (matches.length !== 1)
    throw new Error("Swift Runtime must contain exactly one FIAVersion.current declaration");
  return matches[0]![1]!;
}

export function replaceSwiftFrameworkVersion(
  source: string,
  current: string,
  target: string,
): string {
  if (readSwiftFrameworkVersion(source) !== current)
    throw new Error(`Swift Runtime version does not match package version ${current}`);
  return source.replace(
    `public static let current = "${current}"`,
    `public static let current = "${target}"`,
  );
}

export function readWorkspaceVersionFromLock(source: string): string {
  const start = source.indexOf('"packages/cli":');
  const remaining = start < 0 ? "" : source.slice(start);
  const boundary = /\n\s*"packages"\s*:/.exec(remaining);
  if (start < 0 || boundary?.index === undefined)
    throw new Error("bun.lock does not contain the CLI workspace");
  const match = /"version":\s*"([^"]+)"/.exec(source.slice(start, start + boundary.index));
  if (match === null) throw new Error("bun.lock CLI workspace does not contain a version");
  return match[1]!;
}

function replaceLockVersion(source: string, current: string, target: string): string {
  if (readWorkspaceVersionFromLock(source) !== current)
    throw new Error("bun.lock workspace version does not match package version");
  const start = source.indexOf('"packages/cli":');
  const boundary = /\n\s*"packages"\s*:/.exec(source.slice(start))!;
  const end = start + boundary.index;
  return (
    source.slice(0, start) +
    source.slice(start, end).replace(`"version": "${current}"`, `"version": "${target}"`) +
    source.slice(end)
  );
}

export function nextMinorVersion(current: string): string {
  const { core } = parseVersion(current);
  return `${core[0]}.${core[1] + 1}.0`;
}

export async function updateNPMVersion(target: string): Promise<() => Promise<void>> {
  requireBunVersion();
  const current = cliPackage.version;
  requireIncreasingVersion(current, target);
  const snapshots: Snapshot[] = await Promise.all(
    VERSIONED_PATHS.map(async (path) => ({ path, contents: await readFile(path) })),
  );
  const restore = async () => {
    await Promise.all(snapshots.map((snapshot) => writeFile(snapshot.path, snapshot.contents)));
  };
  try {
    const packageValue = JSON.parse(await readFile(PACKAGE_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    const rootPackageValue = JSON.parse(await readFile(ROOT_PACKAGE_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    if (rootPackageValue.version !== current)
      throw new Error(`root package version does not match package version ${current}`);
    packageValue.version = target;
    rootPackageValue.version = target;
    const metadata = replaceMetadataVersion(await readFile(METADATA_PATH, "utf8"), current, target);
    const swiftVersion = replaceSwiftFrameworkVersion(
      await readFile(SWIFT_VERSION_PATH, "utf8"),
      current,
      target,
    );
    const lock = replaceLockVersion(await readFile(LOCK_PATH, "utf8"), current, target);
    await Promise.all([
      writeFile(PACKAGE_PATH, `${JSON.stringify(packageValue, null, 2)}\n`),
      writeFile(ROOT_PACKAGE_PATH, `${JSON.stringify(rootPackageValue, null, 2)}\n`),
      writeFile(METADATA_PATH, metadata),
      writeFile(SWIFT_VERSION_PATH, swiftVersion),
      writeFile(LOCK_PATH, lock),
    ]);
    await run([process.execPath, "install", "--lockfile-only"]);
    return restore;
  } catch (error) {
    await restore();
    throw new Error("version update failed; versioned files were rolled back", { cause: error });
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      console.log(
        "Usage: bun run version:npm [version]\nDefault: increment minor version. Does not publish or create a Git tag.",
      );
    } else {
      if (args.length > 1) throw new Error("at most one target version is allowed");
      const target = args[0] ?? nextMinorVersion(cliPackage.version);
      await updateNPMVersion(target);
      console.log(
        `version: updated ${cliPackage.version} → ${target}; commit the changes before tagging v${target}`,
      );
    }
  } catch (error) {
    console.error(`version: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
