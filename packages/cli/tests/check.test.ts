import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { checkProject } from "../src/check.ts";
import { createProject } from "../src/create.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function project(local = true): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-check-local-"));
  roots.push(cwd);
  return await createProject({
    name: "check-app",
    cwd,
    local,
    install: false,
    initializeGit: false,
    io: { stdout() {} },
  });
}

describe("local FIA project checks", () => {
  test("accepts a relative local FIA dependency", async () => {
    const root = await project();
    const path = resolve(root, "native/Package.swift");
    const repositoryRoot = resolve(import.meta.dir, "../../..");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(
        `.package(name: "fia", path: ${JSON.stringify(repositoryRoot)})`,
        `.package(path: ${JSON.stringify(relative(resolve(root, "native"), repositoryRoot))})`,
      ),
    );
    expect((await checkProject(root)).ok).toBe(true);
  });

  test("reports a missing or invalid local checkout", async () => {
    for (const invalidPath of ["missing-checkout", "."]) {
      const root = await project();
      const path = resolve(root, "native/Package.swift");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(
          /\.package\(name: "fia", path: "[^"]+"\)/u,
          `.package(name: "fia", path: "${invalidPath}")`,
        ),
      );
      const report = await checkProject(root);
      expect(report.ok).toBe(false);
      expect(report.checks.find((check) => check.id === "native-package")?.message).toContain(
        "Invalid local FIA checkout",
      );
    }
  });

  test("still enforces the native target, platform, and language in local mode", async () => {
    for (const [before, after] of [
      ['name: "FIAAppExecutable"', 'name: "WrongTarget"'],
      [".macOS(.v14)", ".macOS(.v13)"],
      ["swiftLanguageModes: [.v6]", "swiftLanguageModes: [.v5]"],
    ]) {
      const root = await project();
      const path = resolve(root, "native/Package.swift");
      await writeFile(path, (await readFile(path, "utf8")).replace(before!, after!));
      expect((await checkProject(root)).ok).toBe(false);
    }
  });

  test("an unrelated local dependency does not bypass the published FIA version check", async () => {
    const root = await project(false);
    expect((await checkProject(root)).ok).toBe(true);
    const path = resolve(root, "native/Package.swift");
    await writeFile(
      path,
      (await readFile(path, "utf8"))
        .replace(/exact: "[^"]+"/u, 'exact: "0.0.0"')
        .replace(
          "dependencies: [",
          `dependencies: [\n        .package(name: "other", path: ${JSON.stringify(resolve(import.meta.dir, "../../.."))}),`,
        ),
    );
    expect((await checkProject(root)).ok).toBe(false);
  });
});
