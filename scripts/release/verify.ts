import { createHash } from "node:crypto";
import { readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assert, readManifest, config, pkg, root } from "./config";

export const checksum = async (path: string) => createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex");
export async function verifyDirectory(directory: string, manifest: ReturnType<typeof readManifest>) {
  const expected = new Set(manifest.files.map(f => f.path));
  async function walk(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      assert(!entry.isSymbolicLink(), "Symlink in update: " + name);
      if (entry.isDirectory()) await walk(join(path, entry.name), name + "/");
      else assert(entry.isFile() && expected.has(name), "Unexpected update file: " + name);
    }
  }
  await walk(directory);
  for (const file of manifest.files) {
    const path = join(directory, file.path), stat = await lstat(path);
    assert(stat.isFile() && stat.size === file.size && await checksum(path) === file.sha256, "Update checksum mismatch: " + file.path);
  }
}

export async function verifyRelease(directory: string, app?: string) {
  const manifest = readManifest(await Bun.file(join(directory, "latest.json")).text());
  assert(manifest.version === pkg.version && manifest.build === config.build, "Update does not match the source version");
  await verifyDirectory(join(directory, "releases", String(manifest.build)), manifest);
  if (app) {
    const runtime = await Bun.file(join(app, "Contents/Resources/fia.runtime.json")).json();
    assert(runtime.runtimeId === manifest.runtimeId && runtime.app.version === manifest.version && runtime.app.build === manifest.build, "Installer and update use different runtimes or versions");
    assert(runtime.updates?.publicKey === config.publicKey && runtime.updates?.url === config.updatesURL, "Installer does not trust this update feed");
    // Ignore the unsigned factory manifest, but compare every signed code file byte for byte.
    for (const file of manifest.files) assert(await checksum(join(app, "Contents/Resources/code", file.path)) === file.sha256, "Installer/update code differs: " + file.path);
  }
  return manifest;
}
if (import.meta.main) {
  const manifest = await verifyRelease(resolve(process.argv[2] ?? join(root, "dist/updates")), process.argv[3] ? resolve(process.argv[3]) : undefined);
  console.log(`Verified signed update ${manifest.version} (${manifest.build})`);
}
