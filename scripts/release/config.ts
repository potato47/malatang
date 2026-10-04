import { createPublicKey, verify } from "node:crypto";
import config from "../../release/config.json";
import pkg from "../../package.json";

export { config, pkg };
export const root = new URL("../../", import.meta.url).pathname;
export const websiteURL = "https://semicoder.dev/malatang";
const installationURL = `${websiteURL}/docs/installation`;
// Previously signed manifests are immutable; accept only the two known installer pages.
const installerURLs = new Set([installationURL, "https://github.com/potato47/malatang/releases/latest"]);
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validateConfig() {
  assert(config.repository === "potato47/malatang", "Unexpected release repository");
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), "Only stable x.y.z versions can enter the stable update feed");
  assert(Number.isSafeInteger(config.build) && config.build > 0, "Release build must be a positive integer");
  assert(/^[A-Za-z0-9+/]{43}=$/.test(config.publicKey), "Configure a permanent Ed25519 update public key");
  assert(config.updatesURL === "https://nobug.space/malatang/updates/latest.json", "Unexpected Pages update URL");
  assert(config.downloadURL === installationURL, "Use the official installation page");
}
export type Manifest = { schema: number; identifier: string; version: string; build: number; runtimeId: string; baseURL: string; downloadURL?: string; files: { path: string; size: number; sha256: string }[] };
export function readManifest(text: string, publicKey = config.publicKey): Manifest {
  const envelope = JSON.parse(text);
  assert(typeof envelope.payload === "string" && typeof envelope.signature === "string", "Invalid signed manifest");
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64")]), type: "spki", format: "der" });
  const payload = Buffer.from(envelope.payload, "base64");
  assert(verify(null, payload, key, Buffer.from(envelope.signature, "base64")), "Invalid update signature");
  const value = JSON.parse(payload.toString()) as Manifest;
  assert(value.schema === 1 && value.identifier === "com.semicoder.malatang", "Wrong update application");
  assert(Number.isSafeInteger(value.build) && value.build > 0 && /^\d+\.\d+\.\d+$/.test(value.version), "Invalid update version");
  assert(/^[a-f0-9]{64}$/.test(value.runtimeId), "Invalid runtime ID");
  assert(value.baseURL === new URL(`releases/${value.build}/`, config.updatesURL).href, "Unexpected update file origin");
  assert(typeof value.downloadURL === "string" && installerURLs.has(value.downloadURL), "Unexpected installer URL");
  assert(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 4096, "Invalid update file count");
  const paths = new Set<string>(); let size = 0;
  for (const file of value.files) {
    assert(typeof file.path === "string" && !/[\\%?#:\p{Cc}]/u.test(file.path) && file.path.split("/").every(x => x && !x.startsWith(".")), "Unsafe update path");
    assert(!paths.has(file.path.toLowerCase()), "Duplicate update path"); paths.add(file.path.toLowerCase());
    assert(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 268_435_456 && /^[a-f0-9]{64}$/.test(file.sha256), "Invalid update file metadata");
    size += file.size;
  }
  assert(size <= 536_870_912 && paths.has("backend/index.js") && paths.has("web/index.html"), "Invalid update contents");
  return value;
}
