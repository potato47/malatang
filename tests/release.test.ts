import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, pkg, readManifest, type Manifest } from "../scripts/release/config";
import { verifyDirectory, verifyRelease } from "../scripts/release/verify";
import { stageSite } from "../scripts/release/site";

const temporary = await mkdtemp(join(tmpdir(), "malatang-release-test-"));
const original = { ...config }, version = pkg.version;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
config.publicKey = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
afterAll(async () => { Object.assign(config, original); pkg.version = version; await rm(temporary, { recursive: true, force: true }); });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function manifest(build = 1): Manifest { return { schema: 1, identifier: "com.semicoder.malatang", version: `0.${build}.0`, build, runtimeId: "a".repeat(64), baseURL: new URL(`releases/${build}/`, config.updatesURL).href, downloadURL: config.downloadURL, files: [{ path: "backend/index.js", size: 7, sha256: hash("backend") }, { path: "web/index.html", size: 3, sha256: hash("web") }] }; }
function envelope(value: Manifest) { const payload = Buffer.from(JSON.stringify(value)); return JSON.stringify({ payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") }); }
async function fixture(build: number, suffix = "") {
  const directory = join(temporary, `update-${build}${suffix}`), files = join(directory, "releases", String(build));
  await mkdir(join(files, "backend"), { recursive: true }); await mkdir(join(files, "web"), { recursive: true });
  await writeFile(join(files, "backend/index.js"), "backend"); await writeFile(join(files, "web/index.html"), "web");
  await writeFile(join(directory, "latest.json"), envelope(manifest(build)));
  return { directory, files };
}

describe("signed release validation", () => {
  test("rejects forged signatures, foreign origins and traversal even when signed", () => {
    const signed = envelope(manifest()); const changed = JSON.parse(signed); changed.payload = Buffer.from(JSON.stringify({ ...manifest(), build: 2 })).toString("base64");
    expect(() => readManifest(JSON.stringify(changed))).toThrow("signature");
    expect(() => readManifest(envelope({ ...manifest(), baseURL: "https://evil.example/" }))).toThrow("origin");
    expect(() => readManifest(envelope({ ...manifest(), files: [{ path: "../escape", size: 0, sha256: hash("") }] }))).toThrow("Unsafe");
    expect(readManifest(signed).build).toBe(1);
  });
  test("detects missing, changed, extra files and symlinks", async () => {
    const f = await fixture(1, "-integrity"); await verifyDirectory(f.files, manifest());
    await writeFile(join(f.files, "backend/index.js"), "changed"); await expect(verifyDirectory(f.files, manifest())).rejects.toThrow("checksum");
    await writeFile(join(f.files, "backend/index.js"), "backend"); await symlink("index.js", join(f.files, "backend/link")); await expect(verifyDirectory(f.files, manifest())).rejects.toThrow("Symlink");
    await rm(join(f.files, "backend/link")); await writeFile(join(f.files, "extra"), "x"); await expect(verifyDirectory(f.files, manifest())).rejects.toThrow("Unexpected");
    await rm(join(f.files, "extra")); await rm(join(f.files, "web/index.html")); await expect(verifyDirectory(f.files, manifest())).rejects.toThrow();
  });
  test("preserves old downloads, permits identical retry and prevents overwrite/downgrade", async () => {
    const a = await fixture(1), b = await fixture(2), site = join(temporary, "site");
    config.build = 1; pkg.version = "0.1.0"; await stageSite(a.directory, site);
    config.build = 2; pkg.version = "0.2.0"; await stageSite(b.directory, site); await stageSite(b.directory, site);
    expect(await readFile(join(site, "updates/releases/1/backend/index.js"), "utf8")).toBe("backend");
    expect(readManifest(await readFile(join(site, "updates/latest.json"), "utf8")).build).toBe(2);
    config.build = 1; pkg.version = "0.1.0"; await expect(stageSite(a.directory, site)).rejects.toThrow("older build");
    config.build = 2; pkg.version = "0.2.0";
    await writeFile(join(b.directory, "latest.json"), envelope({ ...manifest(2), runtimeId: "b".repeat(64) }));
    await expect(stageSite(b.directory, site)).rejects.toThrow("immutable");
    expect(readManifest(await readFile(join(site, "updates/latest.json"), "utf8")).runtimeId).toBe("a".repeat(64));
  });
  test("installer and update must use the same runtime and code", async () => {
    config.build = 3; pkg.version = "0.3.0";
    const f = await fixture(3), app = join(temporary, "Malatang.app"), resources = join(app, "Contents/Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "fia.runtime.json"), JSON.stringify({ runtimeId: "b".repeat(64), app: { version: "0.3.0", build: 3 }, updates: { url: config.updatesURL, publicKey: config.publicKey } }));
    await expect(verifyRelease(f.directory, app)).rejects.toThrow("different runtimes");
  });
});
