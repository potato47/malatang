import { afterEach, describe, expect, test } from "bun:test";
import { constants } from "node:fs";
import type { FSWatcher } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileManagerService, parseByteRange } from "../src/features/files/service";
import { ShowcaseRepository } from "../src/lib/database";
import { renameExclusive } from "../src/lib/exclusive-rename";
import { AppError } from "../src/lib/http";

const temporary: string[] = [];
afterEach(
  async () =>
    await Promise.all(
      temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ),
);

describe("文件管理服务", () => {
  test("前端 DTO 不泄露绝对根路径，并支持相对路径操作与预览", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await writeFile(resolve(root, "note.txt"), "hello world");
    const repository = new ShowcaseRepository(":memory:");
    const service = new FileManagerService(repository, () => {});
    const publicRoot = await service.addRoot(root);
    expect(publicRoot).not.toHaveProperty("path");
    const listing = await service.list(publicRoot.id);
    expect(listing.root).not.toHaveProperty("path");
    expect(listing.entries[0]?.relativePath).toBe("note.txt");
    const preview = await service.preview(publicRoot.id, "note.txt");
    expect(preview.text).toBe("hello world");
    await service.createDirectory(publicRoot.id, "", "资料");
    const renamed = await service.renameEntry(publicRoot.id, "note.txt", "Note.txt");
    expect(renamed).toBe("Note.txt");
    const duplicate = await service.duplicate(publicRoot.id, renamed);
    expect(duplicate).toContain("副本");
    repository.close();
  });

  test("不预览符号链接，并正确解析 PDF Range", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await writeFile(resolve(root, "real.txt"), "secret");
    await symlink(resolve(root, "real.txt"), resolve(root, "link.txt"));
    const repository = new ShowcaseRepository(":memory:");
    const service = new FileManagerService(repository, () => {});
    const publicRoot = await service.addRoot(root);
    await expect(service.preview(publicRoot.id, "link.txt")).rejects.toThrow("符号链接");
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(() => parseByteRange("bytes=200-", 100)).toThrow("超出文件范围");
    repository.close();
  });

  test("同名目标绝不覆盖，大小写重命名失败会回滚", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await writeFile(resolve(root, "source.txt"), "source");
    await writeFile(resolve(root, "target.txt"), "target");
    await writeFile(resolve(root, "Report.txt"), "report");
    const repository = new ShowcaseRepository(":memory:");
    const normal = new FileManagerService(repository, () => {});
    const publicRoot = await normal.addRoot(root);
    await expect(normal.renameEntry(publicRoot.id, "source.txt", "target.txt")).rejects.toThrow(
      "同名",
    );
    expect(await readFile(resolve(root, "source.txt"), "utf8")).toBe("source");
    expect(await readFile(resolve(root, "target.txt"), "utf8")).toBe("target");

    let renameCalls = 0;
    const failing = new FileManagerService(
      repository,
      () => {},
      async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new AppError("TEST_FAILURE", "模拟第二步失败", 500);
        await renameExclusive(source, destination);
      },
    );
    await expect(failing.renameEntry(publicRoot.id, "Report.txt", "report.txt")).rejects.toThrow(
      "模拟第二步失败",
    );
    expect(await readFile(resolve(root, "Report.txt"), "utf8")).toBe("report");
    repository.close();
  });

  test("复制失败清理唯一临时文件，废纸篓失败保留源项目", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await writeFile(resolve(root, "keep.txt"), "keep");
    const repository = new ShowcaseRepository(":memory:");
    const service = new FileManagerService(
      repository,
      () => {},
      renameExclusive,
      async (source, destination) => await copyFile(source, destination, constants.COPYFILE_EXCL),
      async () => {
        throw new Error("模拟 link 失败");
      },
    );
    const publicRoot = await service.addRoot(root);
    await expect(service.duplicate(publicRoot.id, "keep.txt")).rejects.toThrow("模拟 link 失败");
    expect((await readdir(root)).some((name) => name.startsWith(".fia-copy-"))).toBe(false);
    const conflictError = Object.assign(new Error("目标已存在"), { code: "EEXIST" });
    const conflict = new FileManagerService(
      repository,
      () => {},
      renameExclusive,
      async (source, destination) => await copyFile(source, destination, constants.COPYFILE_EXCL),
      async () => {
        throw conflictError;
      },
    );
    try {
      await conflict.duplicate(publicRoot.id, "keep.txt");
      throw new Error("duplicate 应拒绝竞态同名目标");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(409);
    }
    await expect(
      service.trash(
        {
          system: {
            trashPath: async () => {
              throw new Error("模拟废纸篓失败");
            },
          },
        } as never,
        publicRoot.id,
        "keep.txt",
      ),
    ).rejects.toThrow("模拟废纸篓失败");
    expect(await readFile(resolve(root, "keep.txt"), "utf8")).toBe("keep");
    repository.close();
  });

  test("文件和目录可复制到任意根内目录，失败后清理目录临时项", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await mkdir(resolve(root, "source"));
    await mkdir(resolve(root, "destination"));
    await writeFile(resolve(root, "source", "nested.txt"), "nested");
    const repository = new ShowcaseRepository(":memory:");
    const service = new FileManagerService(repository, () => {});
    const publicRoot = await service.addRoot(root);
    expect(await service.copy(publicRoot.id, "source", "destination")).toBe("destination/source");
    expect(await readFile(resolve(root, "destination", "source", "nested.txt"), "utf8")).toBe(
      "nested",
    );
    await expect(service.copy(publicRoot.id, "source", "destination")).rejects.toThrow("占用");

    await mkdir(resolve(root, "second-destination"));
    const failing = new FileManagerService(
      repository,
      () => {},
      async () => {
        throw new AppError("TEST_FAILURE", "模拟原子提交失败", 500);
      },
    );
    await expect(failing.copy(publicRoot.id, "source", "second-destination")).rejects.toThrow(
      "模拟原子提交失败",
    );
    expect(
      (await readdir(resolve(root, "second-destination"))).some((name) =>
        name.startsWith(".fia-copy-"),
      ),
    ).toBe(false);
    repository.close();
  });

  test("文本只读取 1 MiB，非法 UTF-8 降级，并以 Range 流式返回 PDF", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    await writeFile(resolve(root, "large.txt"), Buffer.alloc(1024 * 1024 + 32, 97));
    await writeFile(resolve(root, "invalid.txt"), new Uint8Array([0xc3, 0x28]));
    await writeFile(resolve(root, "sample.pdf"), "0123456789");
    const repository = new ShowcaseRepository(":memory:");
    const service = new FileManagerService(repository, () => {});
    const publicRoot = await service.addRoot(root);
    const large = await service.preview(publicRoot.id, "large.txt");
    expect(large.text?.length).toBe(1024 * 1024);
    expect(large.truncated).toBe(true);
    expect((await service.preview(publicRoot.id, "invalid.txt")).kind).toBe("unsupported");
    const pdf = await service.preview(publicRoot.id, "sample.pdf");
    const token = pdf.contentURL?.split("/").pop();
    expect(token).toBeDefined();
    const response = await service.content(token!, "bytes=2-5");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await response.text()).toBe("2345");
    repository.close();
  });

  test("只监听当前目录，合并变更并在 close 后停止发布", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-files-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const events: unknown[] = [];
    let emit = () => {};
    let closed = false;
    const watcher = {
      close() {
        closed = true;
      },
      on() {
        return watcher;
      },
    } as unknown as FSWatcher;
    const service = new FileManagerService(
      repository,
      (event) => events.push(event),
      undefined,
      undefined,
      undefined,
      (_path, listener) => {
        emit = () => {
          if (!closed) listener();
        };
        return watcher;
      },
    );
    const publicRoot = await service.addRoot(root);
    events.length = 0;
    expect((await service.replaceWatch(publicRoot.id)).watching).toBe(true);
    emit();
    emit();
    await Bun.sleep(240);
    expect(events).toHaveLength(1);
    service.closeWatch();
    emit();
    await Bun.sleep(240);
    expect(events).toHaveLength(1);
    repository.close();
  });
});
