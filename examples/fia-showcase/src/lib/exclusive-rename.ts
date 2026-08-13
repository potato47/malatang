import { dlopen, FFIType } from "bun:ffi";
import { lstat } from "node:fs/promises";
import { AppError } from "./http";

const RENAME_EXCL = 0x4;

const libSystem = dlopen("/usr/lib/libSystem.B.dylib", {
  renamex_np: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.uint32_t],
    returns: FFIType.int32_t,
  },
});

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Atomically renames a filesystem entry without replacing an existing target.
 * FIA Toolbox targets macOS, where renamex_np(RENAME_EXCL) provides the required
 * single-syscall guarantee for both files and directories.
 */
export async function renameExclusive(source: string, destination: string): Promise<void> {
  const sourceCString = Buffer.from(`${source}\0`);
  const destinationCString = Buffer.from(`${destination}\0`);
  if (libSystem.symbols.renamex_np(sourceCString, destinationCString, RENAME_EXCL) === 0) return;

  // Bun FFI does not expose errno portably. Inspect both endpoints after the
  // failed atomic operation to distinguish the user-actionable conflict case.
  if (await exists(destination)) {
    throw new AppError("CONFLICT", "目标名称已被占用", 409);
  }
  if (!(await exists(source))) {
    throw new AppError("SOURCE_CHANGED", "源项目已被其他操作移动或删除", 409);
  }
  throw new AppError("MOVE_FAILED", "系统未能完成原子移动，请检查目录权限", 500);
}
