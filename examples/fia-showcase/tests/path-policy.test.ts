import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  normalizeRelativePath,
  resolveManagedEntry,
  resolveReadableEntry,
} from "../src/lib/path-policy";

const temporary: string[] = [];
afterEach(
  async () =>
    await Promise.all(
      temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ),
);

describe("文件根路径策略", () => {
  test("拒绝绝对路径、遍历、根操作和符号链接", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-path-"));
    temporary.push(root);
    const outside = await mkdtemp(resolve(tmpdir(), "fia-showcase-outside-"));
    temporary.push(outside);
    await writeFile(resolve(root, "note.txt"), "hello");
    await symlink(resolve(outside, "secret.txt"), resolve(root, "escape"));

    expect(() => normalizeRelativePath("../outside")).toThrow("不能离开根目录");
    expect(() => normalizeRelativePath("/tmp/outside")).toThrow("相对路径");
    await expect(resolveManagedEntry(root, "")).rejects.toThrow("不能对根目录");
    await expect(resolveReadableEntry(root, "escape")).rejects.toThrow("符号链接");
  });

  test("只返回根内普通文件和目录", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-path-"));
    temporary.push(root);
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "docs/note.txt"), "hello");
    const value = await resolveReadableEntry(root, "docs/note.txt", { allowDirectory: false });
    expect(value.relativePath).toBe("docs/note.txt");
    expect(value.kind).toBe("file");
  });
});
