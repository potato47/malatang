import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CodeRelease } from "./artifacts.ts";

export interface SignedRelease {
  payload: string;
  signature: string;
}
export function signRelease(release: CodeRelease, pem: string, publicKey: string): SignedRelease {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Update key must be Ed25519");
  const derived = createPublicKey(pem)
    .export({ type: "spki", format: "der" })
    .subarray(-32)
    .toString("base64");
  if (derived !== publicKey) throw new Error("Update private key does not match updates.publicKey");
  const data = Buffer.from(JSON.stringify(release));
  return { payload: data.toString("base64"), signature: sign(null, data, key).toString("base64") };
}
export function verifyRelease(envelope: SignedRelease, publicKey: string): CodeRelease {
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKey, "base64"),
    ]),
    type: "spki",
    format: "der",
  });
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify(null, payload, key, Buffer.from(envelope.signature, "base64")))
    throw new Error("Invalid update signature");
  return JSON.parse(payload.toString());
}
export async function writeSignedRelease(release: CodeRelease, publicKey: string, output: string) {
  const path = process.env.FIA_UPDATE_PRIVATE_KEY_FILE;
  if (!path) throw new Error("Set FIA_UPDATE_PRIVATE_KEY_FILE to an Ed25519 PEM private key");
  const envelope = signRelease(release, await readFile(path, "utf8"), publicKey);
  await writeFile(output, JSON.stringify(envelope, null, 2) + "\n");
}
export async function generateUpdateKeys(output: string) {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const secret = resolve(output, "update-private.pem");
  await writeFile(secret, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
    flag: "wx",
  });
  const key = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  await writeFile(resolve(output, "update-public.txt"), key + "\n", { flag: "wx" });
  return { privateKeyFile: secret, publicKey: key };
}
