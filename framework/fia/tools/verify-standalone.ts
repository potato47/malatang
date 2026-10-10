import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { repositoryRoot, runInteractive } from "./shared.ts";

// Export only sources: never borrow parent dependencies, locks, native assets or caches.
export async function exportFramework(destination: string) {
  await cp(repositoryRoot, destination, {
    recursive: true,
    filter: (source) => {
      const path = relative(repositoryRoot, source);
      return (
        !path
          .split("/")
          .some((part) =>
            [
              ".git",
              "node_modules",
              ".build",
              ".fia",
              ".temp",
              "dist",
              "artifacts",
              ".DS_Store",
            ].includes(part),
          ) &&
        !["packages/cli/assets", "packages/cli/docs"].some(
          (prefix) => path === prefix || path.startsWith(prefix + "/"),
        )
      );
    },
  });
}

if (import.meta.main) {
  const temporary = await mkdtemp(resolve(tmpdir(), "fia-standalone-"));
  try {
    const framework = resolve(temporary, "framework");
    await exportFramework(framework);
    await runInteractive([process.execPath, "install", "--ignore-scripts"], { cwd: framework });
    await runInteractive([process.execPath, "tools/task.ts", "check"], { cwd: framework });
    const archives = resolve(temporary, "archives");
    await runInteractive([process.execPath, "tools/task.ts", "pack", archives], { cwd: framework });
    const pkg = JSON.parse(await readFile(resolve(framework, "packages/cli/package.json"), "utf8"));
    const consumers = resolve(temporary, "consumers");
    await mkdir(consumers);
    await runInteractive(
      [
        process.execPath,
        resolve(framework, "packages/cli/bin/fia"),
        "create",
        "independent-app",
        "--yes",
        "--no-install",
        "--no-git",
        "--local",
      ],
      { cwd: consumers },
    );
    const projectRoot = resolve(consumers, "independent-app");
    const packagePath = resolve(projectRoot, "package.json");
    const app = JSON.parse(await readFile(packagePath, "utf8"));
    app.dependencies["@semicoder/fia"] =
      "file:" + resolve(archives, `semicoder-fia-${pkg.version}.tgz`);
    await writeFile(packagePath, JSON.stringify(app, null, 2) + "\n");
    await runInteractive([process.execPath, "install", "--ignore-scripts"], { cwd: projectRoot });
    for (const command of ["check", "build", "smoke"]) {
      await runInteractive([process.execPath, "node_modules/@semicoder/fia/bin/fia", command], {
        cwd: projectRoot,
      });
    }
    console.log("framework: standalone source, archive and independent application passed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
