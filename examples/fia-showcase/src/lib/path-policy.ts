import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { AppError } from "./http";

export function isPathInside(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
}

export function normalizeRelativePath(value: string, allowRoot = true): string {
  if (value.includes("\0") || isAbsolute(value)) {
    throw new AppError("INVALID_PATH", "必须使用根目录内的相对路径");
  }
  const normalized = normalize(value.replaceAll("\\", "/"));
  if (normalized === ".") {
    if (allowRoot) return "";
    throw new AppError("ROOT_OPERATION_DENIED", "不能对根目录本身执行此操作", 403);
  }
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new AppError("OUTSIDE_ROOT", "相对路径不能离开根目录", 403);
  }
  return normalized;
}

export async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new AppError("INVALID_PATH", "目录必须是绝对路径");
  const canonical = await realpath(path);
  const information = await lstat(canonical);
  if (!information.isDirectory()) throw new AppError("NOT_DIRECTORY", "所选路径不是目录");
  return canonical;
}

async function canonicalRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    throw new AppError("ROOT_NOT_FOUND", "已授权根目录当前不可访问", 404);
  }
}

export async function resolveReadableEntry(
  root: string,
  relativePath: string,
  options: { allowRoot?: boolean; allowDirectory?: boolean; allowFile?: boolean } = {},
): Promise<{ absolutePath: string; relativePath: string; kind: "file" | "directory" }> {
  const normalized = normalizeRelativePath(relativePath, options.allowRoot ?? true);
  const lexical = resolve(root, normalized);
  let lexicalInformation;
  try {
    lexicalInformation = await lstat(lexical);
  } catch {
    throw new AppError("NOT_FOUND", "文件或目录不存在", 404);
  }
  if (lexicalInformation.isSymbolicLink()) {
    throw new AppError("SYMLINK_DENIED", "为避免越界访问，不能直接操作符号链接", 403);
  }
  if (!lexicalInformation.isFile() && !lexicalInformation.isDirectory()) {
    throw new AppError("SPECIAL_FILE_DENIED", "不支持套接字、设备或其他特殊文件", 403);
  }
  const canonical = await realpath(lexical);
  if (!isPathInside(await canonicalRoot(root), canonical)) {
    throw new AppError("OUTSIDE_ROOT", "路径不在已授权的文件根目录中", 403);
  }
  const kind = lexicalInformation.isDirectory() ? "directory" : "file";
  if (kind === "directory" && options.allowDirectory === false) {
    throw new AppError("NOT_FILE", "目标必须是普通文件");
  }
  if (kind === "file" && options.allowFile === false) {
    throw new AppError("NOT_DIRECTORY", "目标必须是目录");
  }
  return { absolutePath: canonical, relativePath: normalized, kind };
}

export async function resolveManagedEntry(
  root: string,
  relativePath: string,
): Promise<{ absolutePath: string; relativePath: string; kind: "file" | "directory" }> {
  const normalized = normalizeRelativePath(relativePath, false);
  const lexical = resolve(root, normalized);
  let information;
  try {
    information = await lstat(lexical);
  } catch {
    throw new AppError("NOT_FOUND", "文件或目录不存在", 404);
  }
  if (information.isSymbolicLink()) {
    throw new AppError("SYMLINK_DENIED", "为避免越界操作，不能修改符号链接", 403);
  }
  if (!information.isFile() && !information.isDirectory()) {
    throw new AppError("SPECIAL_FILE_DENIED", "不支持修改特殊文件", 403);
  }
  const canonicalParent = await realpath(dirname(lexical));
  if (!isPathInside(await canonicalRoot(root), canonicalParent)) {
    throw new AppError("OUTSIDE_ROOT", "路径不在已授权的文件根目录中", 403);
  }
  return {
    absolutePath: resolve(canonicalParent, basename(lexical)),
    relativePath: normalized,
    kind: information.isDirectory() ? "directory" : "file",
  };
}

export function validateEntryName(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0")
  ) {
    throw new AppError("INVALID_NAME", "名称不能为空、不能包含 /，且最多 255 个字符");
  }
  return name;
}

export async function resolveNewChild(
  root: string,
  directoryRelativePath: string,
  name: string,
): Promise<{ directory: string; destination: string; relativePath: string }> {
  const directory = await resolveReadableEntry(root, directoryRelativePath, {
    allowRoot: true,
    allowDirectory: true,
    allowFile: false,
  });
  const entryName = validateEntryName(name);
  return {
    directory: directory.absolutePath,
    destination: resolve(directory.absolutePath, entryName),
    relativePath: normalizeRelativePath(join(directory.relativePath, entryName)),
  };
}
