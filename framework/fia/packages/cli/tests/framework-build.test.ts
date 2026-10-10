import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fingerprint, withBuildLock } from "../../../tools/prepare.ts";

test("build fingerprints detect edits, additions, deletions and executable bit changes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-fingerprint-"));
  try {
    await mkdir(resolve(root, "src"));
    const first = await fingerprint(root, ["src"]);
    const file = resolve(root, "src/a.ts");
    await writeFile(file, "one");
    const second = await fingerprint(root, ["src"]);
    const revision = await fingerprint(root, ["src"], true);
    expect(second).not.toBe(first);
    expect(await fingerprint(root, ["src"])).toBe(second);
    await writeFile(file, "two");
    const third = await fingerprint(root, ["src"]);
    expect(third).not.toBe(second);
    await writeFile(file, "one");
    expect(await fingerprint(root, ["src"])).toBe(second);
    expect(await fingerprint(root, ["src"], true)).not.toBe(revision);
    await writeFile(file, "two");
    await chmod(file, 0o755);
    expect(await fingerprint(root, ["src"])).not.toBe(third);
    await rm(file);
    expect(await fingerprint(root, ["src"])).toBe(first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("framework build lock rejects overlapping writers and is released after failure", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "fia-build-lock-"));
  try {
    await expect(
      withBuildLock(async () => {
        await expect(withBuildLock(async () => {}, root)).rejects.toThrow("already locked");
        throw new Error("compile failed");
      }, root),
    ).rejects.toThrow("compile failed");
    expect(await withBuildLock(async () => "recovered", root)).toBe("recovered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
