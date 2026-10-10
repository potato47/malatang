import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { findWorkspace } from "../../../tools/workspace.ts";
import { readWorkspaceVersionFromLock } from "../../../tools/version-npm.ts";
import { standaloneLockFixture } from "./workspace.fixture.ts";
import pkg from "../package.json";

test("framework metadata resolves either standalone or parent workspace without a nested lock", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-workspace-"));
  try {
    const framework = resolve(root, "framework/fia");
    await mkdir(framework, { recursive: true });
    const source = standaloneLockFixture("framework/fia/packages/cli");
    await writeFile(resolve(root, "bun.lock"), source);
    expect(await findWorkspace(framework)).toEqual({
      root,
      lock: resolve(root, "bun.lock"),
      packagePath: "framework/fia/packages/cli",
    });
    expect(readWorkspaceVersionFromLock(source, "framework/fia/packages/cli")).toBe(pkg.version);
    await writeFile(resolve(framework, "bun.lock"), standaloneLockFixture());
    expect((await findWorkspace(framework)).root).toBe(framework);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
