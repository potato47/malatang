import { access, constants, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultAppPath, repositoryRoot, run } from "./shared.ts";

interface PrototypeConfiguration {
  schemaVersion: number;
  protocolVersion: number;
  app: {
    name: string;
    identifier: string;
    quitOnLastWindowClosed: boolean;
  };
  window: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  };
}

async function requireExecutable(path: string): Promise<void> {
  await access(path, constants.X_OK);
}

async function plistValue(plist: string, key: string): Promise<string> {
  return (await run(["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist], { quiet: true })).trim();
}

export async function verifyApp(appPath = defaultAppPath): Promise<void> {
  const absoluteApp = resolve(appPath);
  const contents = resolve(absoluteApp, "Contents");
  const host = resolve(contents, "MacOS/FIAHost");
  const runtime = resolve(contents, "MacOS/fia-runtime");
  const plist = resolve(contents, "Info.plist");
  const configPath = resolve(contents, "Resources/fia-config.json");

  await Promise.all([
    requireExecutable(host),
    requireExecutable(runtime),
    access(plist, constants.R_OK),
    access(configPath, constants.R_OK),
  ]);

  const expectedPlist = new Map([
    ["CFBundleIdentifier", "dev.fia.prototype"],
    ["CFBundleExecutable", "FIAHost"],
    ["CFBundlePackageType", "APPL"],
    ["LSMinimumSystemVersion", "14.0"],
  ]);
  for (const [key, expected] of expectedPlist) {
    const actual = await plistValue(plist, key);
    if (actual !== expected) throw new Error(`Info.plist ${key} is ${actual}; expected ${expected}`);
  }

  const configuration = JSON.parse(await readFile(configPath, "utf8")) as PrototypeConfiguration;
  if (
    configuration.schemaVersion !== 1 ||
    configuration.protocolVersion !== 1 ||
    configuration.app.identifier !== "dev.fia.prototype" ||
    configuration.app.name !== "FIA Prototype" ||
    configuration.app.quitOnLastWindowClosed !== true ||
    configuration.window.width < configuration.window.minWidth ||
    configuration.window.height < configuration.window.minHeight
  ) {
    throw new Error("fia-config.json does not match the phase 0 strict configuration");
  }
  const rootKeys = Object.keys(configuration).sort().join(",");
  if (rootKeys !== "app,protocolVersion,schemaVersion,window") {
    throw new Error("fia-config.json contains unexpected top-level fields");
  }

  for (const executable of [host, runtime]) {
    const architectures = (await run(["/usr/bin/lipo", "-archs", executable], { quiet: true })).trim();
    if (architectures !== "arm64") {
      throw new Error(`${executable} has architectures ${architectures}; expected arm64`);
    }
  }

  await run(["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", absoluteApp]);
  console.log(`Verified ${absoluteApp}`);
}

if (import.meta.main) {
  const argument = process.argv[2];
  await verifyApp(argument === undefined ? defaultAppPath : resolve(repositoryRoot, argument));
}

