import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { repositoryRoot } from "./shared.ts";

/** A framework checkout can be a package subtree of a larger Bun workspace. */
export async function findWorkspace(frameworkRoot = repositoryRoot) {
  const packageRoot = resolve(frameworkRoot, "packages/cli");
  let root = resolve(frameworkRoot);
  for (;;) {
    const lock = resolve(root, "bun.lock");
    const source = await readFile(lock, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const packagePath = relative(root, packageRoot).split("\\").join("/");
    if (source !== null && source.includes(JSON.stringify(packagePath) + ":"))
      return { root, lock, packagePath };
    const parent = dirname(root);
    if (parent === root)
      throw new Error("FIA workspace lockfile missing; run bun install at the repository root");
    root = parent;
  }
}
