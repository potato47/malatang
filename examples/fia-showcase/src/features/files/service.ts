import type { Desktop } from "@semicoder/fia/backend";
import { constants } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readdir, rm, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { ShowcaseRepository, type StoredFileRoot } from "../../lib/database";
import { renameExclusive } from "../../lib/exclusive-rename";
import { AppError } from "../../lib/http";
import {
  canonicalDirectory,
  normalizeRelativePath,
  resolveManagedEntry,
  resolveNewChild,
  resolveReadableEntry,
} from "../../lib/path-policy";
import type {
  AppEvent,
  DirectoryListing,
  FileEntry,
  FilePreview,
  FileRoot,
  PreviewKind,
  RecentFileLocation,
} from "../../shared/contracts";

const MAX_ENTRIES = 1_000;
const MAX_TEXT_BYTES = 1024 * 1024;
const TOKEN_TTL_MS = 5 * 60_000;
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff"]);
const textExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".html",
  ".swift",
  ".sh",
  ".py",
  ".rs",
  ".go",
]);

interface PreviewToken {
  rootId: string;
  relativePath: string;
  expiresAt: number;
}

type WatchFactory = (path: string, listener: () => void) => FSWatcher;
const watchDirectory: WatchFactory = (path, listener) =>
  watch(path, { persistent: false }, listener);

function mimeForExtension(extension: string): string {
  const values: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
    ".json": "application/json; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
  };
  return values[extension] ?? "text/plain; charset=utf-8";
}

function previewKind(extension: string): PreviewKind {
  if (imageExtensions.has(extension)) return "image";
  if (extension === ".pdf") return "pdf";
  if (textExtensions.has(extension) || extension === "") return "text";
  return "unsupported";
}

export function parseByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) {
    throw new AppError("INVALID_RANGE", "Range 请求格式无效", 416);
  }
  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0)
      throw new AppError("INVALID_RANGE", "Range 请求无效", 416);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    throw new AppError("INVALID_RANGE", "Range 超出文件范围", 416);
  }
  return { start, end: Math.min(end, size - 1) };
}

export class FileManagerService {
  readonly #tokens = new Map<string, PreviewToken>();
  #watcher: FSWatcher | null = null;
  #watchTimer: ReturnType<typeof setTimeout> | null = null;
  #watchScope: { rootId: string; relativePath: string } | null = null;

  constructor(
    private readonly repository: ShowcaseRepository,
    private readonly publish: (event: AppEvent) => void,
    private readonly moveNoReplace: (
      source: string,
      destination: string,
    ) => Promise<void> = renameExclusive,
    private readonly copyExclusive: (source: string, destination: string) => Promise<void> = async (
      source,
      destination,
    ) => await copyFile(source, destination, constants.COPYFILE_EXCL),
    private readonly linkExclusive: (source: string, destination: string) => Promise<void> = link,
    private readonly watchFactory: WatchFactory = watchDirectory,
  ) {}

  roots(): FileRoot[] {
    return this.repository.listRoots().map(({ path: _path, ...root }) => root);
  }

  recent(): RecentFileLocation[] {
    return this.repository.recentFileLocations();
  }

  root(id: string): StoredFileRoot {
    const root = this.repository.getRoot(id);
    if (root === null) throw new AppError("ROOT_NOT_FOUND", "文件根目录不存在", 404);
    return root;
  }

  async addRoot(path: string): Promise<FileRoot> {
    const canonical = await canonicalDirectory(path);
    const existing = this.repository.listRoots().find((root) => root.path === canonical);
    if (existing !== undefined) {
      const { path: _path, ...publicRoot } = existing;
      return publicRoot;
    }
    const root: StoredFileRoot = {
      id: crypto.randomUUID(),
      path: canonical,
      name: basename(canonical) || "Macintosh HD",
      createdAt: new Date().toISOString(),
    };
    this.repository.addRoot(root);
    this.publish({ type: "files.changed", rootId: root.id, path: "" });
    const { path: _path, ...publicRoot } = root;
    return publicRoot;
  }

  removeRoot(id: string): void {
    if (!this.repository.removeRoot(id))
      throw new AppError("ROOT_NOT_FOUND", "文件根目录不存在", 404);
    if (this.#watchScope?.rootId === id) this.closeWatch();
    for (const [token, value] of this.#tokens) if (value.rootId === id) this.#tokens.delete(token);
    this.publish({ type: "files.changed", rootId: id });
  }

  async list(
    rootId: string,
    requestedRelativePath = "",
    showHidden = false,
  ): Promise<DirectoryListing> {
    const root = this.root(rootId);
    const directory = await resolveReadableEntry(root.path, requestedRelativePath, {
      allowRoot: true,
      allowDirectory: true,
      allowFile: false,
    });
    const directoryEntries = await readdir(directory.absolutePath, { withFileTypes: true });
    const visible = showHidden
      ? directoryEntries
      : directoryEntries.filter((entry) => !entry.name.startsWith("."));
    const selected = visible.slice(0, MAX_ENTRIES);
    const entries = await Promise.all(
      selected.map(async (entry): Promise<FileEntry> => {
        const absolutePath = resolve(directory.absolutePath, entry.name);
        const details = await lstat(absolutePath);
        return {
          relativePath: normalizeRelativePath(join(directory.relativePath, entry.name)),
          name: entry.name,
          kind: details.isSymbolicLink()
            ? "symlink"
            : details.isDirectory()
              ? "directory"
              : details.isFile()
                ? "file"
                : "other",
          size: details.isFile() ? details.size : null,
          modifiedAt: details.mtime.toISOString(),
          hidden: entry.name.startsWith("."),
          extension: extname(entry.name).toLowerCase(),
        };
      }),
    );
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    entries.sort((left, right) => {
      const leftDirectory = left.kind === "directory" ? 0 : 1;
      const rightDirectory = right.kind === "directory" ? 0 : 1;
      return leftDirectory - rightDirectory || collator.compare(left.name, right.name);
    });
    const parent = dirname(directory.relativePath);
    const listing = {
      root: (({ path: _path, ...publicRoot }) => publicRoot)(root),
      relativePath: directory.relativePath,
      parentRelativePath:
        directory.relativePath === "" || parent === "." ? null : normalizeRelativePath(parent),
      entries,
      truncated: visible.length > MAX_ENTRIES,
    };
    this.repository.recordFileLocation(rootId, directory.relativePath);
    return listing;
  }

  async replaceWatch(
    rootId: string,
    relativePath = "",
  ): Promise<{ watching: boolean; detail: string }> {
    this.closeWatch();
    const root = this.root(rootId);
    const directory = await resolveReadableEntry(root.path, relativePath, {
      allowRoot: true,
      allowDirectory: true,
      allowFile: false,
    });
    try {
      this.#watchScope = { rootId, relativePath: directory.relativePath };
      this.#watcher = this.watchFactory(directory.absolutePath, () => {
        if (this.#watchTimer !== null) clearTimeout(this.#watchTimer);
        this.#watchTimer = setTimeout(() => {
          const scope = this.#watchScope;
          if (scope !== null)
            this.publish({ type: "files.changed", rootId: scope.rootId, path: scope.relativePath });
          this.#watchTimer = null;
        }, 180);
      });
      this.#watcher.on("error", (error) => {
        console.warn("当前目录监听失败，可继续手动刷新", error);
        this.closeWatch();
      });
      return { watching: true, detail: "当前目录变更会自动刷新" };
    } catch (error) {
      console.warn("当前目录监听不可用，可继续手动刷新", error);
      this.closeWatch();
      return {
        watching: false,
        detail: "目录监听不可用，可继续手动刷新",
      };
    }
  }

  closeWatch(): void {
    this.#watcher?.close();
    this.#watcher = null;
    this.#watchScope = null;
    if (this.#watchTimer !== null) clearTimeout(this.#watchTimer);
    this.#watchTimer = null;
  }

  async preview(rootId: string, relativePath: string): Promise<FilePreview> {
    const root = this.root(rootId);
    const entry = await resolveReadableEntry(root.path, relativePath, {
      allowRoot: false,
      allowDirectory: false,
      allowFile: true,
    });
    const information = await lstat(entry.absolutePath);
    const extension = extname(entry.absolutePath).toLowerCase();
    const kind = previewKind(extension);
    const base = {
      rootId,
      relativePath: entry.relativePath,
      name: basename(entry.absolutePath),
      kind,
      mimeType: mimeForExtension(extension),
      size: information.size,
      modifiedAt: information.mtime.toISOString(),
    };
    if (kind === "image" || kind === "pdf") {
      const token = this.#issueToken(rootId, entry.relativePath);
      return { ...base, contentURL: `/api/files/content/${token}` };
    }
    if (kind !== "text") return base;
    const handle = await open(entry.absolutePath, "r");
    const slice = new Uint8Array(Math.min(information.size, MAX_TEXT_BYTES + 1));
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(slice, 0, slice.byteLength, 0));
    } finally {
      await handle.close();
    }
    const textBytes = slice.subarray(0, Math.min(bytesRead, MAX_TEXT_BYTES));
    if (textBytes.includes(0)) return { ...base, kind: "unsupported" };
    try {
      return {
        ...base,
        text: new TextDecoder("utf-8", { fatal: true }).decode(textBytes),
        truncated: information.size > MAX_TEXT_BYTES,
      };
    } catch {
      return { ...base, kind: "unsupported" };
    }
  }

  async content(token: string, rangeHeader: string | null): Promise<Response> {
    const tokenValue = this.#tokens.get(token);
    if (tokenValue === undefined || tokenValue.expiresAt <= Date.now()) {
      this.#tokens.delete(token);
      throw new AppError("PREVIEW_EXPIRED", "预览链接已失效，请重新打开预览", 404);
    }
    const root = this.root(tokenValue.rootId);
    const entry = await resolveReadableEntry(root.path, tokenValue.relativePath, {
      allowRoot: false,
      allowDirectory: false,
      allowFile: true,
    });
    const file = Bun.file(entry.absolutePath);
    const size = file.size;
    const extension = extname(entry.absolutePath).toLowerCase();
    const headers = {
      "Content-Type": mimeForExtension(extension),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };
    let range;
    try {
      range = parseByteRange(rangeHeader, size);
    } catch (error) {
      if (error instanceof AppError && error.status === 416) {
        return new Response(null, {
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${size}` },
        });
      }
      throw error;
    }
    if (range === null)
      return new Response(file, { headers: { ...headers, "Content-Length": String(size) } });
    const body = file.slice(range.start, range.end + 1);
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  async createDirectory(
    rootId: string,
    directoryRelativePath: string,
    name: string,
  ): Promise<string> {
    const root = this.root(rootId);
    const target = await resolveNewChild(root.path, directoryRelativePath, name);
    try {
      await mkdir(target.destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AppError("CONFLICT", "同名文件或目录已存在", 409);
      }
      throw error;
    }
    this.publish({
      type: "files.changed",
      rootId,
      path: normalizeRelativePath(directoryRelativePath),
    });
    return target.relativePath;
  }

  async renameEntry(rootId: string, relativePath: string, name: string): Promise<string> {
    const root = this.root(rootId);
    const source = await resolveManagedEntry(root.path, relativePath);
    const destination = await resolveNewChild(root.path, dirname(source.relativePath), name);
    const sourceName = basename(source.absolutePath);
    const destinationName = basename(destination.destination);
    if (sourceName === destinationName) return source.relativePath;
    const caseOnly =
      sourceName.toLocaleLowerCase("en-US") === destinationName.toLocaleLowerCase("en-US");
    if (!caseOnly && (await this.#exists(destination.destination))) {
      throw new AppError("CONFLICT", "同名文件或目录已存在", 409);
    }
    if (caseOnly && (await this.#exists(destination.destination))) {
      const [left, right] = await Promise.all([
        lstat(source.absolutePath),
        lstat(destination.destination),
      ]);
      if (left.dev !== right.dev || left.ino !== right.ino) {
        throw new AppError("CONFLICT", "目标名称已被另一个项目占用", 409);
      }
    }
    if (!caseOnly) {
      await this.moveNoReplace(source.absolutePath, destination.destination);
    } else {
      const temporary = resolve(dirname(source.absolutePath), `.fia-rename-${crypto.randomUUID()}`);
      await this.moveNoReplace(source.absolutePath, temporary);
      try {
        await this.moveNoReplace(temporary, destination.destination);
      } catch (error) {
        try {
          await this.moveNoReplace(temporary, source.absolutePath);
        } catch (rollbackError) {
          console.error("大小写重命名回滚失败", rollbackError);
        }
        throw error;
      }
    }
    this.publish({
      type: "files.changed",
      rootId,
      path: normalizeRelativePath(dirname(source.relativePath)),
    });
    return destination.relativePath;
  }

  async duplicate(rootId: string, relativePath: string): Promise<string> {
    const root = this.root(rootId);
    const source = await resolveReadableEntry(root.path, relativePath, {
      allowRoot: false,
      allowDirectory: false,
      allowFile: true,
    });
    const extension = extname(source.absolutePath);
    const stem = basename(source.absolutePath, extension);
    const directory = dirname(source.absolutePath);
    let destination: string | null = null;
    for (let index = 1; index <= 100; index += 1) {
      const suffix = index === 1 ? " 副本" : ` 副本 ${index}`;
      const candidate = resolve(directory, `${stem}${suffix}${extension}`);
      if (!(await this.#exists(candidate))) {
        destination = candidate;
        break;
      }
    }
    if (destination === null) throw new AppError("CONFLICT", "无法生成可用的副本名称", 409);
    const temporary = resolve(directory, `.fia-copy-${crypto.randomUUID()}.tmp`);
    try {
      await this.copyExclusive(source.absolutePath, temporary);
      await this.linkExclusive(temporary, destination);
      await unlink(temporary);
    } catch (error) {
      await rm(temporary, { force: true });
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AppError("CONFLICT", "目标名称已被占用", 409);
      }
      throw error;
    }
    const result = normalizeRelativePath(relative(root.path, destination));
    this.publish({
      type: "files.changed",
      rootId,
      path: normalizeRelativePath(dirname(source.relativePath)),
    });
    return result;
  }

  async copy(
    rootId: string,
    relativePath: string,
    destinationDirectoryRelativePath: string,
  ): Promise<string> {
    const root = this.root(rootId);
    const source = await resolveManagedEntry(root.path, relativePath);
    const directory = await resolveReadableEntry(root.path, destinationDirectoryRelativePath, {
      allowRoot: true,
      allowDirectory: true,
      allowFile: false,
    });
    const information = await lstat(source.absolutePath);
    if (
      information.isDirectory() &&
      (directory.absolutePath === source.absolutePath ||
        directory.absolutePath.startsWith(`${source.absolutePath}${sep}`))
    ) {
      throw new AppError("INVALID_DESTINATION", "不能把目录复制到自身内部", 409);
    }
    const destination = resolve(directory.absolutePath, basename(source.absolutePath));
    const temporary = resolve(directory.absolutePath, `.fia-copy-${crypto.randomUUID()}.tmp`);
    try {
      await this.#copyTreeExclusive(source.absolutePath, temporary);
      await this.moveNoReplace(temporary, destination);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (error instanceof AppError) throw error;
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AppError("CONFLICT", "目标目录已有同名项目", 409);
      }
      console.error("复制文件或目录失败", error);
      throw new AppError("COPY_FAILED", "复制失败，源项目保持不变", 500);
    }
    this.publish({ type: "files.changed", rootId, path: directory.relativePath });
    return normalizeRelativePath(relative(root.path, destination));
  }

  async move(
    rootId: string,
    relativePath: string,
    destinationDirectoryRelativePath: string,
  ): Promise<string> {
    const root = this.root(rootId);
    const source = await resolveManagedEntry(root.path, relativePath);
    const directory = await resolveReadableEntry(root.path, destinationDirectoryRelativePath, {
      allowRoot: true,
      allowDirectory: true,
      allowFile: false,
    });
    const sourceInformation = await lstat(source.absolutePath);
    const directoryInformation = await lstat(directory.absolutePath);
    if (sourceInformation.dev !== directoryInformation.dev) {
      throw new AppError(
        "CROSS_VOLUME_MOVE",
        "不支持跨卷移动；请先复制并确认，再手动删除原文件",
        409,
      );
    }
    const destination = resolve(directory.absolutePath, basename(source.absolutePath));
    if (destination === source.absolutePath) return source.relativePath;
    if (
      source.kind === "directory" &&
      (directory.absolutePath === source.absolutePath ||
        directory.absolutePath.startsWith(`${source.absolutePath}${sep}`))
    ) {
      throw new AppError("INVALID_DESTINATION", "不能把目录移动到自身内部", 409);
    }
    if (await this.#exists(destination))
      throw new AppError("CONFLICT", "目标目录已有同名项目", 409);
    await this.moveNoReplace(source.absolutePath, destination);
    this.publish({ type: "files.changed", rootId, path: directory.relativePath });
    return normalizeRelativePath(relative(root.path, destination));
  }

  async trash(desktop: Desktop, rootId: string, relativePath: string): Promise<void> {
    const root = this.root(rootId);
    const source = await resolveManagedEntry(root.path, relativePath);
    await desktop.system.trashPath(source.absolutePath);
    this.publish({
      type: "files.changed",
      rootId,
      path: normalizeRelativePath(dirname(source.relativePath)),
    });
  }

  async systemPath(rootId: string, relativePath: string): Promise<string> {
    const root = this.root(rootId);
    return (
      await resolveReadableEntry(root.path, relativePath, {
        allowRoot: true,
        allowDirectory: true,
        allowFile: true,
      })
    ).absolutePath;
  }

  #issueToken(rootId: string, relativePath: string): string {
    const now = Date.now();
    for (const [token, value] of this.#tokens)
      if (value.expiresAt <= now) this.#tokens.delete(token);
    const token = crypto.randomUUID().replaceAll("-", "");
    this.#tokens.set(token, { rootId, relativePath, expiresAt: now + TOKEN_TTL_MS });
    return token;
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async #copyTreeExclusive(source: string, destination: string): Promise<void> {
    const information = await lstat(source);
    if (information.isSymbolicLink())
      throw new AppError("SYMLINK_DENIED", "复制范围内包含符号链接，操作已拒绝", 409);
    if (information.isFile()) {
      await this.copyExclusive(source, destination);
      return;
    }
    if (!information.isDirectory())
      throw new AppError("SPECIAL_FILE_DENIED", "复制范围内包含特殊文件，操作已拒绝", 409);
    await mkdir(destination);
    const entries = await readdir(source);
    for (const entry of entries) {
      await this.#copyTreeExclusive(resolve(source, entry), resolve(destination, entry));
    }
  }
}
