import { projectFiles } from "./template.ts";
import { cp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_VERSION } from "./metadata.ts";
import type { CreateOptions } from "./create-options.ts";

export async function createProject(options: CreateOptions, cwd = process.cwd()) {
  const name = options.name;
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name))
    throw new Error("Project name must be lowercase kebab-case");
  const root = resolve(cwd, name);
  await mkdir(root); // Never replace an existing project.
  try {
    await mkdir(resolve(root, "backend"));
    await mkdir(resolve(root, "frontend"));
    await mkdir(resolve(root, "assets"));
    await mkdir(resolve(root, "shared"));
    await mkdir(resolve(root, "agent"));
    const localPackage = await realpath(resolve(import.meta.dir, ".."));
    const spec = options.local ? "file:" + localPackage : CLI_VERSION;
    const title = name
      .split("-")
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(" ");
    const files = projectFiles(name, title, spec);
    for (const [path, content] of Object.entries(files))
      await writeFile(resolve(root, path), content);
    for (const file of ["icon.png", "icon.icns"])
      await cp(
        resolve(import.meta.dir, "../templates/assets", file),
        resolve(root, "assets", file),
      );
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  for (const command of [
    ...(options.install ? [[process.execPath, "install"]] : []),
    ...(options.git ? [["git", "init"]] : []),
  ]) {
    const child = Bun.spawn(command, {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await child.exited) !== 0)
      throw new Error("Project created at " + root + "; command failed: " + command.join(" "));
  }
  return { projectRoot: root };
}
