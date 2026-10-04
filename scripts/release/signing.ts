import { mkdir, writeFile, rm, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { assert, config } from "./config";

assert(process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP, "Signing setup is only for disposable GitHub runners");
const directory = join(process.env.RUNNER_TEMP, "malatang-signing"), keychain = join(directory, "release.keychain-db");
async function run(command: string[], label: string) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert(await child.exited === 0, label + " failed; check the signing credentials");
  return output;
}
if (process.argv[2] === "cleanup") {
  try {
    const original = JSON.parse(await readFile(join(directory, "keychains.json"), "utf8")) as string[];
    await run(["security", "list-keychains", "-d", "user", "-s", ...original], "Restore keychain list");
    const previousDefault = await readFile(join(directory, "default-keychain.txt"), "utf8");
    await run(["security", "default-keychain", "-d", "user", "-s", previousDefault], "Restore default keychain");
  } catch { /* Setup may have failed before creating the keychain. */ }
  await run(["security", "delete-keychain", keychain], "Delete temporary keychain").catch(() => {});
  await rm(directory, { recursive: true, force: true });
} else {
  const required = ["APPLE_CERTIFICATE_P12", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_TEAM_ID", "APPLE_APP_SPECIFIC_PASSWORD", "FIA_UPDATE_PRIVATE_KEY", "MALATANG_SIGNING_IDENTITY"];
  for (const name of required) assert(process.env[name], "Missing GitHub signing configuration: " + name);
  const privateKey = createPrivateKey(process.env.FIA_UPDATE_PRIVATE_KEY!);
  assert(privateKey.asymmetricKeyType === "ed25519" && createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64") === config.publicKey, "Update private key does not match the committed public key");
  await mkdir(directory, { mode: 0o700 });
  const original = await run(["security", "list-keychains", "-d", "user"], "Read keychain list");
  const keychains = [...original.matchAll(/"([^"\n]+)"/g)].map(match => match[1]!);
  await writeFile(join(directory, "keychains.json"), JSON.stringify(keychains), { mode: 0o600 });
  const defaultKeychain = (await run(["security", "default-keychain", "-d", "user"], "Read default keychain")).trim().replace(/^"|"$/g, "");
  await writeFile(join(directory, "default-keychain.txt"), defaultKeychain, { mode: 0o600 });
  const certificate = join(directory, "certificate.p12"), updateKey = join(directory, "update-private.pem");
  await writeFile(certificate, Buffer.from(process.env.APPLE_CERTIFICATE_P12!, "base64"), { mode: 0o600 });
  await writeFile(updateKey, process.env.FIA_UPDATE_PRIVATE_KEY!, { mode: 0o600 });
  const password = randomBytes(32).toString("hex");
  await run(["security", "create-keychain", "-p", password, keychain], "Create temporary keychain");
  await run(["security", "set-keychain-settings", "-lut", "21600", keychain], "Configure temporary keychain");
  await run(["security", "unlock-keychain", "-p", password, keychain], "Unlock temporary keychain");
  await run(["security", "import", certificate, "-k", keychain, "-P", process.env.APPLE_CERTIFICATE_PASSWORD!, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"], "Import Developer ID certificate");
  await run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain], "Allow codesign access");
  await run(["security", "list-keychains", "-d", "user", "-s", keychain, ...keychains], "Select signing keychain");
  await run(["security", "default-keychain", "-d", "user", "-s", keychain], "Select notarization keychain");
  await run(["xcrun", "notarytool", "store-credentials", "malatang-notary", "--apple-id", process.env.APPLE_ID!, "--team-id", process.env.APPLE_TEAM_ID!, "--password", process.env.APPLE_APP_SPECIFIC_PASSWORD!, "--keychain", keychain], "Validate notarization credentials");
  assert(process.env.GITHUB_ENV, "Missing GitHub environment file");
  await appendFile(process.env.GITHUB_ENV, `FIA_UPDATE_PRIVATE_KEY_FILE=${updateKey}\n`);
  await rm(certificate);
  console.log("Signing credentials prepared in an ephemeral keychain.");
}
