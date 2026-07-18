import { chmod, cp, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildUI } from "./build-ui.ts";
import {
  assertInsideWorkspace,
  defaultAppPath,
  repositoryRoot,
  requireBunVersion,
  run,
} from "./shared.ts";
import { verifyApp } from "./verify-prototype.ts";

const configuration = {
  schemaVersion: 1,
  protocolVersion: 1,
  app: {
    name: "FIA Prototype",
    identifier: "dev.fia.prototype",
    quitOnLastWindowClosed: true,
  },
  window: {
    width: 1024,
    height: 700,
    minWidth: 720,
    minHeight: 480,
  },
} as const;

function infoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>FIA Prototype</string>
  <key>CFBundleExecutable</key><string>FIAHost</string>
  <key>CFBundleIdentifier</key><string>dev.fia.prototype</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>FIA Prototype</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
`;
}

async function build(): Promise<void> {
  requireBunVersion();
  const buildID = `${Date.now()}-${crypto.randomUUID()}`;
  const buildRoot = resolve(repositoryRoot, ".fia/build", buildID);
  const app = resolve(buildRoot, "FIAPrototype.app");
  const macOS = resolve(app, "Contents/MacOS");
  const resources = resolve(app, "Contents/Resources");
  const swiftScratch = resolve(buildRoot, "swift");
  const hostOutput = resolve(swiftScratch, "arm64-apple-macosx/release/FIAHost");
  const hostDestination = resolve(macOS, "FIAHost");
  const runtimeDestination = resolve(macOS, "fia-runtime");
  [buildRoot, app, defaultAppPath].forEach(assertInsideWorkspace);

  await buildUI();
  await run([process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"]);
  await mkdir(macOS, { recursive: true });
  await mkdir(resources, { recursive: true });

  const cacheEnvironment = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: resolve(repositoryRoot, ".fia/cache/clang-module-cache"),
    SWIFTPM_MODULECACHE_OVERRIDE: resolve(repositoryRoot, ".fia/cache/swiftpm-module-cache"),
  };
  await run([
    "/usr/bin/swift",
    "build",
    "-c",
    "release",
    "--arch",
    "arm64",
    "--package-path",
    resolve(repositoryRoot, "host"),
    "--scratch-path",
    swiftScratch,
  ], { env: cacheEnvironment });
  await cp(hostOutput, hostDestination);

  await run([
    process.execPath,
    "build",
    "--compile",
    "--target=bun-darwin-arm64",
    "--minify",
    resolve(repositoryRoot, "prototype/runtime/src/entry.ts"),
    "--outfile",
    runtimeDestination,
  ]);

  await Promise.all([
    chmod(hostDestination, 0o755),
    chmod(runtimeDestination, 0o755),
    Bun.write(resolve(app, "Contents/Info.plist"), infoPlist()),
    Bun.write(resolve(app, "Contents/PkgInfo"), "APPL????"),
    Bun.write(resolve(resources, "fia-config.json"), `${JSON.stringify(configuration, null, 2)}\n`),
  ]);

  for (const target of [runtimeDestination, hostDestination, app]) {
    await run(["/usr/bin/codesign", "--force", "--sign", "-", target]);
  }
  await verifyApp(app);

  await mkdir(resolve(repositoryRoot, "dist"), { recursive: true });
  const previous = resolve(buildRoot, "previous-FIAPrototype.app");
  if (await Bun.file(resolve(defaultAppPath, "Contents/Info.plist")).exists()) {
    await rename(defaultAppPath, previous);
  }
  try {
    await rename(app, defaultAppPath);
  } catch (error) {
    if (await Bun.file(resolve(previous, "Contents/Info.plist")).exists()) {
      await rename(previous, defaultAppPath);
    }
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  await verifyApp(defaultAppPath);
  console.log(`Built ${defaultAppPath}`);
}

await build();

