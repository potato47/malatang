import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, root, validVersion, validatePackage } from "./check";

export function assertVersionIncrease(current: string, next: string | undefined) {
  assert(validVersion(current) && validVersion(next), "Usage: bun run version:sdk <x.y.z>");
  const a = current.split(".").map(Number), b = next.split(".").map(Number);
  const difference = a.findIndex((part, i) => part !== b[i]);
  assert(difference >= 0 && b[difference]! > a[difference]!, "SDK version must increase");
}

if (import.meta.main) {
  const path = join(root, "packages/sdk/package.json");
  const original = await Bun.file(path).text();
  const lockfile = join(root, "bun.lock");
  const originalLockfile = await Bun.file(lockfile).text();
  const pkg = JSON.parse(original);
  validatePackage(pkg);
  const version = process.argv[2];
  assertVersionIncrease(pkg.version, version);
  await writeFile(path, JSON.stringify({ ...pkg, version }, null, 2) + "\n");
  try {
    const child = Bun.spawn([process.execPath, "install", "--lockfile-only", "--ignore-scripts"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    assert(await child.exited === 0, "Could not update bun.lock");
  } catch (error) {
    await writeFile(path, original);
    await writeFile(lockfile, originalLockfile);
    throw error;
  }
  console.log(`SDK ${version}. Commit packages/sdk/package.json and bun.lock before tagging sdk-v${version}. Application and plugin versions are unchanged.`);
}
