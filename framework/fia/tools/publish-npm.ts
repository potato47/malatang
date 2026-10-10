import { run, runInteractive, repositoryRoot } from "./shared.ts";
import { CLI_VERSION } from "../packages/cli/src/metadata.ts";
import { findWorkspace } from "./workspace.ts";
import cli from "../packages/cli/package.json";
import root from "../package.json";
import { nextMinorVersion, requireIncreasingVersion, updateNPMVersion } from "./version-npm.ts";

const publishCommand = [
  "npm",
  "publish",
  "--workspace=@semicoder/fia",
  "--access=public",
  "--noproxy=registry.npmjs.org",
  "--fetch-timeout=900000",
  "--fetch-retries=0",
  "--loglevel=http",
] as const;

export function parseReleaseArguments(args: readonly string[]) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))
    return { help: true, dryRun: false, version: undefined };
  let version: string | undefined;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else if (version !== undefined) throw new Error("at most one target version is allowed");
    else version = arg;
  }
  return { help: false, dryRun, version };
}

export async function releaseNPM(args: readonly string[]): Promise<void> {
  const options = parseReleaseArguments(args);
  if (options.help) {
    console.log("Usage: bun run release [version] [--dry-run]\nDefault: increment minor version.");
    return;
  }
  if (!options.dryRun && (await findWorkspace()).root !== repositoryRoot)
    throw new Error(
      "FIA npm publishing is disabled inside a parent workspace; extract the framework before publishing",
    );
  const target = options.version ?? nextMinorVersion(cli.version);
  requireIncreasingVersion(cli.version, target);
  if (cli.version !== CLI_VERSION || root.version !== CLI_VERSION)
    throw new Error("Framework package versions must match");
  if (!options.dryRun && (await run(["git", "status", "--porcelain"], { quiet: true })).trim())
    throw new Error("Refusing to publish a dirty worktree");

  console.log(`release: updating version ${cli.version} → ${target}`);
  const restoreVersion = await updateNPMVersion(target);
  let published = false;
  try {
    console.log("release: building bundled runtimes");
    await runInteractive([process.execPath, "run", "runtime:build"]);
    // A fresh process loads the updated CLI_VERSION instead of the cached import.
    await runInteractive([
      process.execPath,
      "-e",
      'await import("./packages/cli/src/artifacts.ts").then(m => m.verifyAssets())',
    ]);
    console.log("release: running checks");
    await runInteractive([process.execPath, "run", "check"]);
    console.log("release: checking npm package (dry-run)");
    await runInteractive([...publishCommand, "--dry-run"], { cwd: repositoryRoot });
    if (options.dryRun) {
      console.log("release: dry-run complete; nothing was published");
    } else {
      console.log("release: publishing to npm; complete any authentication prompts below");
      await runInteractive(publishCommand, { cwd: repositoryRoot });
      published = true;
      console.log(`release: published ${cli.name}@${target}`);
    }
  } finally {
    if (!published) {
      await restoreVersion();
      console.log("release: versioned files were restored");
    }
  }
}

if (import.meta.main) {
  try {
    await releaseNPM(process.argv.slice(2));
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
