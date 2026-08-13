import { chmod, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import cliPackage from "../packages/cli/package.json";
import { repositoryRoot, run } from "./shared.ts";

const buildID = `${Date.now()}-${crypto.randomUUID()}`;
const scratch = resolve(repositoryRoot, ".fia/host-assets", buildID);
const source = resolve(scratch, "arm64-apple-macosx/release/FIAHost");
const destinationDirectory = resolve(repositoryRoot, "packages/cli/assets/host/darwin-arm64");
const destination = resolve(destinationDirectory, "FIAHost");

const cacheEnvironment = {
  ...process.env,
  CLANG_MODULE_CACHE_PATH: resolve(repositoryRoot, ".fia/cache/clang-module-cache"),
  SWIFTPM_MODULECACHE_OVERRIDE: resolve(repositoryRoot, ".fia/cache/swiftpm-module-cache"),
};

await run(
  [
    "/usr/bin/swift",
    "build",
    "-c",
    "release",
    "--arch",
    "arm64",
    "--package-path",
    resolve(repositoryRoot, "host"),
    "--scratch-path",
    scratch,
  ],
  { env: cacheEnvironment },
);

const architectures = (await run(["/usr/bin/lipo", "-archs", source], { quiet: true })).trim();
if (architectures !== "arm64")
  throw new Error(`Host architecture is ${architectures}; expected arm64`);

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
const hasher = new Bun.CryptoHasher("sha256");
hasher.update(await Bun.file(destination).arrayBuffer());
const manifest = {
  schemaVersion: 3,
  cliVersion: cliPackage.version,
  hostVersion: cliPackage.version,
  sha256: hasher.digest("hex"),
  architecture: "arm64",
  minimumSystemVersion: "14.0",
  configurationSchema: 8,
  stdioProtocol: 2,
  hostCapabilities: [
    "application",
    "statusItem",
    "webviews",
    "system",
    "notifications",
    "dialogs",
    "clipboard",
    "keychain",
    "globalShortcuts",
    "screens",
    "screenCapture",
  ],
};
await Bun.write(
  resolve(destinationDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Packaged Host ${cliPackage.version} at ${destination}`);
