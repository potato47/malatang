import { mkdtemp, mkdir, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import lock from "../../release/runtime-lock.json";
import { assert, root } from "./config";

// Install the exact prebuilt package. Never rebuild native binaries for an app release.
const destination = resolve(root, "../fia/packages/cli");
assert(!(await lstat(destination).catch(() => null)), "Runtime destination already exists; use the existing local FIA checkout or a clean CI workspace");
const temporary = await mkdtemp(join(tmpdir(), "malatang-runtime-"));
try {
  const archive = join(temporary, lock.asset);
  const result = Bun.spawn(["gh", "release", "download", lock.tag, "--repo", lock.repository, "--pattern", lock.asset, "--dir", temporary], { stdout: "inherit", stderr: "inherit" });
  assert(await result.exited === 0, "Cannot download the pinned FIA package. Complete the bootstrap upload first.");
  assert(createHash("sha256").update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest("hex") === lock.sha256, "Pinned FIA package checksum mismatch");
  await mkdir(destination, { recursive: true });
  const extract = Bun.spawn(["tar", "-xzf", archive, "--strip-components=1", "-C", destination], { stdout: "inherit", stderr: "inherit" });
  assert(await extract.exited === 0, "Cannot extract FIA package");
  const pkg = await Bun.file(join(destination, "package.json")).json();
  assert(pkg.name === "@semicoder/fia" && pkg.version === lock.version, "Wrong FIA package");
  console.log(`Prepared FIA ${lock.version}, source ${lock.commit}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
