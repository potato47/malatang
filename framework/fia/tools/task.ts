import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareLocked, withBuildLock } from "./prepare.ts";
import { checkNPMPackage } from "./check-npm-package.ts";
import { repositoryRoot, runInteractive } from "./shared.ts";
import { findWorkspace } from "./workspace.ts";
import pkg from "../packages/cli/package.json";

export async function packFramework(output?: string) {
  const workspace = await findWorkspace();
  output = resolve(output ?? resolve(workspace.root, "artifacts/fia"));
  await mkdir(output, { recursive: true });
  const archive = resolve(output, `semicoder-fia-${pkg.version}.tgz`);
  await rm(archive, { force: true });
  await runInteractive(
    ["npm", "pack", "--workspace=@semicoder/fia", "--ignore-scripts", "--pack-destination", output],
    { cwd: workspace.root },
  );
  const temporary = await mkdtemp(resolve(tmpdir(), "fia-package-check-"));
  try {
    await runInteractive(["tar", "-xzf", archive, "-C", temporary]);
    await checkNPMPackage(resolve(temporary, "package"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log("framework: verified archive " + archive);
  return archive;
}

if (import.meta.main) {
  try {
    const [command, output] = process.argv.slice(2);
    if (!command || !["check", "pack"].includes(command)) throw new Error("Expected check or pack");
    await withBuildLock(async () => {
      await prepareLocked();
      if (command === "check") {
        await runInteractive([process.execPath, "run", "check"], { cwd: repositoryRoot });
        // check includes a CLI rebuild. Verify and refresh its recorded hashes.
        await prepareLocked();
      } else await packFramework(output);
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
