import { run, repositoryRoot } from "./shared.ts";
import { verifyAssets } from "../packages/cli/src/artifacts.ts";
import { CLI_VERSION } from "../packages/cli/src/metadata.ts";
import cli from "../packages/cli/package.json";
import root from "../package.json";

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
await run([process.execPath, "run", "runtime:build"]);
await verifyAssets();
await run([process.execPath, "run", "check"]);
await run(["npm", "publish", "--workspace=@semicoder/fia", "--access=public", "--dry-run"], {
  cwd: repositoryRoot,
});
if (!args.includes("--dry-run"))
  await run(["npm", "publish", "--workspace=@semicoder/fia", "--access=public"], {
    cwd: repositoryRoot,
  });
