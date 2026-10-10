import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, rename, lstat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { verifyAssets } from "../packages/cli/src/artifacts.ts";
import { BUNDLED_BUN_VERSION } from "../packages/cli/src/metadata.ts";
import { repositoryRoot, run, withCommandCancellation } from "./shared.ts";
import { findWorkspace } from "./workspace.ts";

export const buildStateDirectory = resolve(repositoryRoot, ".fia/framework-build");
export const reportPath = resolve(buildStateDirectory, "report.json");
export const nativeInputs = [
  "Package.swift",
  "Package.resolved",
  "Sources",
  "tools/build-runtime.ts",
  "tools/shared.ts",
  "tools/prepare.ts",
  "packages/cli/src/metadata.ts",
  "packages/cli/src/artifacts.ts",
];
export const cliInputs = [
  "packages/cli/src",
  "packages/cli/scripts",
  "packages/cli/tsconfig.build.json",
  "packages/cli/package.json",
  "packages/cli/bin",
  "packages/cli/templates",
  "tsconfig.json",
  "types",
  "docs/framework",
  "package.json",
];
const ignored = new Set([
  ".git",
  ".build",
  ".fia",
  ".temp",
  "node_modules",
  "dist",
  "target",
  "artifacts",
  ".DS_Store",
]);

/** Names, contents and executable bits matter; timestamps never establish freshness. */
export async function fingerprint(root: string, paths: readonly string[]) {
  const hash = createHash("sha256");
  async function walk(name: string) {
    const path = resolve(root, name);
    const stat = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    hash.update(
      JSON.stringify([name, stat?.isDirectory() ? "directory" : stat ? "file" : "missing"]),
    );
    if (!stat) return;
    if (stat.isSymbolicLink())
      throw new Error("Framework input/output cannot be a symlink: " + path);
    if (stat.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await walk(name + "/" + child);
    } else if (stat.isFile()) {
      hash.update(String(stat.mode & 0o111));
      hash.update(await readFile(path));
    } else throw new Error("Unsupported framework file: " + path);
  }
  for (const name of [...paths].sort()) await walk(name);
  return hash.digest("hex");
}

export async function sourceFingerprint(root = repositoryRoot) {
  const paths: string[] = [];
  async function walk(name: string) {
    for (const entry of await readdir(resolve(root, name), { withFileTypes: true })) {
      const path = name ? name + "/" + entry.name : entry.name;
      if (ignored.has(entry.name) || ["packages/cli/assets", "packages/cli/docs"].includes(path))
        continue;
      if (entry.isDirectory()) await walk(path);
      else paths.push(path);
    }
  }
  await walk("");
  return fingerprint(root, paths);
}

export async function withBuildLock<T>(
  action: () => Promise<T>,
  directory = buildStateDirectory,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const lock = resolve(directory, "lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "FIA build already locked at " +
        lock +
        "; wait for its owner, or remove this lock only after confirming that process has stopped",
    );
  }
  try {
    await writeFile(
      resolve(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }) + "\n",
    );
    return await withCommandCancellation(action);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export interface BuildRecord {
  input: string;
  output: string;
}
export interface BuildReport {
  schema: 1;
  source: { commit: string | null; dirty: boolean | null; framework: string; lock: string };
  toolchain: {
    bun: string;
    bunSHA256: string;
    swift: string;
    sdk: string;
    sdkPath: string;
    platform: string;
    architecture: string;
  };
  native: BuildRecord;
  cli: BuildRecord;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function prepareLocked(): Promise<BuildReport> {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("FIA source builds require Apple Silicon macOS");
  if (Bun.version !== BUNDLED_BUN_VERSION) throw new Error("Use Bun " + BUNDLED_BUN_VERSION);
  const workspace = await findWorkspace();
  const toolchain: BuildReport["toolchain"] = {
    bun: Bun.version,
    bunSHA256: createHash("sha256")
      .update(await readFile(process.execPath))
      .digest("hex"),
    swift: (await run(["swift", "--version"], { quiet: true })).trim(),
    sdk: (await run(["xcrun", "--sdk", "macosx", "--show-sdk-version"], { quiet: true })).trim(),
    sdkPath: (await run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], { quiet: true })).trim(),
    platform: process.platform,
    architecture: process.arch,
  };
  const lockHash = createHash("sha256")
    .update(await readFile(workspace.lock))
    .digest("hex");
  const nativeInput = digest([await fingerprint(repositoryRoot, nativeInputs), toolchain]);
  const cliInput = digest([
    await fingerprint(repositoryRoot, cliInputs),
    lockHash,
    toolchain.bun,
    toolchain.bunSHA256,
  ]);
  const previousNative = (await Bun.file(resolve(buildStateDirectory, "native.json"))
    .json()
    .catch(() => null)) as BuildRecord | null;
  const previousCLI = (await Bun.file(resolve(buildStateDirectory, "cli.json"))
    .json()
    .catch(() => null)) as BuildRecord | null;
  const assetPath = "packages/cli/assets/darwin-arm64";
  const cliOutputPaths = ["packages/cli/dist", "packages/cli/docs/framework"];
  let nativeOutput = await fingerprint(repositoryRoot, [assetPath]);
  let cliOutput = await fingerprint(repositoryRoot, cliOutputPaths);
  const rebuildNative =
    previousNative?.input !== nativeInput || previousNative?.output !== nativeOutput;
  const rebuildCLI = previousCLI?.input !== cliInput || previousCLI?.output !== cliOutput;
  // Invalidate before writing any output. An interrupted/failed build must never be reused.
  if (rebuildNative || rebuildCLI) await rm(reportPath, { force: true });
  if (rebuildNative) {
    await rm(resolve(buildStateDirectory, "native.json"), { force: true });
    console.log("framework: building native runtime");
    await run([process.execPath, "tools/build-runtime.ts"]);
    nativeOutput = await fingerprint(repositoryRoot, [assetPath]);
    await verifyAssets();
    if (nativeInput === digest([await fingerprint(repositoryRoot, nativeInputs), toolchain]))
      await writeFile(
        resolve(buildStateDirectory, "native.json"),
        JSON.stringify({ input: nativeInput, output: nativeOutput }),
      );
  }
  if (rebuildCLI) {
    await rm(resolve(buildStateDirectory, "cli.json"), { force: true });
    console.log("framework: building CLI and SDK");
    await run([process.execPath, "packages/cli/scripts/build.ts"]);
    cliOutput = await fingerprint(repositoryRoot, cliOutputPaths);
  }
  await verifyAssets();
  // Reject a build whose sources changed while a compiler was reading them.
  if (
    nativeInput !== digest([await fingerprint(repositoryRoot, nativeInputs), toolchain]) ||
    cliInput !==
      digest([
        await fingerprint(repositoryRoot, cliInputs),
        createHash("sha256")
          .update(await readFile(workspace.lock))
          .digest("hex"),
        toolchain.bun,
        toolchain.bunSHA256,
      ])
  ) {
    await rm(reportPath, { force: true });
    throw new Error("Framework sources changed during the build; rebuild the latest sources");
  }
  await writeFile(
    resolve(buildStateDirectory, "cli.json"),
    JSON.stringify({ input: cliInput, output: cliOutput }),
  );
  const commit = await run(["git", "rev-parse", "HEAD"], { cwd: workspace.root, quiet: true })
    .then((x) => x.trim())
    .catch(() => null);
  const dirty = commit
    ? await run(["git", "status", "--porcelain"], { cwd: workspace.root, quiet: true }).then(
        (x) => !!x.trim(),
      )
    : null;
  const report: BuildReport = {
    schema: 1,
    source: { commit, dirty, framework: await sourceFingerprint(), lock: lockHash },
    toolchain,
    native: { input: nativeInput, output: nativeOutput },
    cli: { input: cliInput, output: cliOutput },
  };
  const temporary = reportPath + "." + process.pid + ".tmp";
  await writeFile(temporary, JSON.stringify(report, null, 2) + "\n");
  await rename(temporary, reportPath);
  const publicReport = resolve(workspace.root, "artifacts/fia/build-report.json");
  await mkdir(resolve(workspace.root, "artifacts/fia"), { recursive: true });
  await writeFile(publicReport, JSON.stringify(report, null, 2) + "\n");
  console.log(
    "framework: " +
      (rebuildNative || rebuildCLI ? "ready" : "verified cached outputs") +
      " (" +
      relative(workspace.root, reportPath) +
      ")",
  );
  return report;
}
export const prepareFramework = () => withBuildLock(prepareLocked);

if (import.meta.main) {
  try {
    await prepareFramework();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
