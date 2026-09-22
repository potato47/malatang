import { run, runInteractive, repositoryRoot } from "./shared.ts";
import { verifyAssets } from "../packages/cli/src/artifacts.ts";
import { CLI_VERSION } from "../packages/cli/src/metadata.ts";
import cli from "../packages/cli/package.json";
import root from "../package.json";

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

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run"))
  throw new Error("Usage: bun run release:npm [--dry-run]");
if (cli.version !== CLI_VERSION || root.version !== CLI_VERSION)
  throw new Error("Framework package versions must match");
if (
  !args.includes("--dry-run") &&
  (await run(["git", "status", "--porcelain"], { quiet: true })).trim()
)
  throw new Error("Refusing to publish a dirty worktree");
console.log("release:npm: building bundled runtimes");
await runInteractive([process.execPath, "run", "runtime:build"]);
await verifyAssets();
console.log("release:npm: running checks");
await runInteractive([process.execPath, "run", "check"]);
console.log("release:npm: checking npm package (dry-run)");
await runInteractive([...publishCommand, "--dry-run"], { cwd: repositoryRoot });
if (args.includes("--dry-run")) {
  console.log("release:npm: dry-run complete; nothing was published");
} else {
  console.log("release:npm: publishing to npm; complete any authentication prompts below");
  await runInteractive(publishCommand, {
    cwd: repositoryRoot,
  });
  console.log(`release:npm: published ${cli.name}@${cli.version}`);
}
