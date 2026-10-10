import { resolve } from "node:path";
import { prepareLocked, withBuildLock } from "./prepare.ts";
import { repositoryRoot, runInteractive } from "./shared.ts";
import { buildApplication, launchPreview } from "../packages/cli/src/application.ts";
import { loadProjectConfig } from "../packages/cli/src/project-config.ts";

// Hold the same lock while the application consumes framework files for packaging.
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["run", "build", "release"].includes(command))
    throw new Error("Expected run, build or release");
  if (command === "run") {
    if (args.length) throw new Error("run accepts no options");
    const prepared = await withBuildLock(async () => {
      await prepareLocked();
      const config = await loadProjectConfig(process.cwd());
      return { config, built: await buildApplication(config, { preview: true }) };
    });
    process.exitCode = await launchPreview(prepared.config, prepared.built);
  } else {
    await withBuildLock(async () => {
      await prepareLocked();
      await runInteractive(
        [process.execPath, resolve(repositoryRoot, "packages/cli/bin/fia"), command, ...args],
        { cwd: process.cwd() },
      );
    });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
