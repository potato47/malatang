import { cp, mkdir, rename, lstat, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assert, config, readManifest } from "./config";
import { verifyRelease, verifyDirectory, checksum } from "./verify";

export async function stageSite(updateDirectory: string, site: string) {
  const next = await verifyRelease(updateDirectory);
  const updates = join(site, "updates"), latest = join(updates, "latest.json");
  if (await Bun.file(latest).exists()) {
    const previousText = await Bun.file(latest).text(), previous = readManifest(previousText);
    assert(next.build >= previous.build, "Refusing to roll the stable feed back to an older build");
    if (next.build === previous.build) assert(previousText === await Bun.file(join(updateDirectory, "latest.json")).text(), "Published build is immutable; increment the version/build");
    else {
      const a = next.version.split(".").map(Number), b = previous.version.split(".").map(Number);
      const changed = a.findIndex((value, i) => value !== b[i]);
      assert(changed >= 0 && a[changed]! > b[changed]!, "Release version must increase with its build number");
    }
  }
  const destination = join(updates, "releases", String(next.build));
  if (await lstat(destination).catch(() => null)) await verifyDirectory(destination, next);
  else { await mkdir(join(updates, "releases"), { recursive: true }); await cp(join(updateDirectory, "releases", String(next.build)), destination, { recursive: true, errorOnExist: true, force: false }); }
  // Retain every previous release: clients may still be downloading an older manifest.
  let total = 0;
  async function measure(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), "Symlink in published site");
      const child = join(path, entry.name);
      if (entry.isDirectory()) await measure(child); else total += (await lstat(child)).size;
    }
  }
  await measure(updates);
  assert(total < 900_000_000, "Update site approaches the GitHub Pages size limit; migrate hosting before publishing");
  await cp(join(updateDirectory, "latest.json"), latest + ".tmp"); await rename(latest + ".tmp", latest);
  await writeFile(join(site, ".nojekyll"), "");
  await writeFile(join(site, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>麻辣烫下载</title><style>body{font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;line-height:1.8}a{color:inherit}</style><h1>麻辣烫 · Malatang</h1><p>本地插件应用平台</p><p>当前版本 ${next.version} · macOS 14 及以上 · Apple Silicon</p><p><a href="${config.downloadURL}">下载最新版本</a></p><p>应用会自动检查和下载更新，确认后安装。请在更新前保存草稿。</p></html>\n`);
  console.log(`Staged immutable build ${next.build}; manifest SHA256 ${await checksum(latest)}`);
}
if (import.meta.main) {
  assert(process.argv[2] && process.argv[3], "Usage: site.ts <updates> <site>");
  await stageSite(resolve(process.argv[2]), resolve(process.argv[3]));
}
