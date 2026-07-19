import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CLI_VERSION } from "./metadata.ts";
import { loadProjectConfig, type ResolvedFIAConfig } from "./project-config.ts";

export interface ApplicationIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export type ApplicationCommand = "dev" | "build" | "run";

export interface ApplicationCommandDependencies {
  managedRuntimePath?: string;
  hostAssetDirectory?: string;
}

export interface ApplicationCommandOptions {
  command: ApplicationCommand;
  cwd: string;
  debug: boolean;
  io: ApplicationIO;
  dependencies?: ApplicationCommandDependencies;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface HostManifest {
  schemaVersion: 1;
  cliVersion: string;
  hostVersion: string;
  sha256: string;
  architecture: "arm64";
  minimumSystemVersion: "14.0";
  configurationSchemas: readonly [1, 2];
  runtimeProtocol: 1;
}

interface BuildContext {
  config: ResolvedFIAConfig;
  stagingRoot: string;
  appPath: string;
  managedRuntimePath: string;
  hostAssetDirectory: string;
  debug: boolean;
  io: ApplicationIO;
}

const BUN_VERSION = "1.3.14";
const HOST_EXECUTABLE = "FIAHost";
const RUNTIME_EXECUTABLE = "fia-runtime";
const CSP_NONCE = "__FIA_CSP_NONCE__";

function commandText(command: readonly string[]): string {
  return command.map((part) => JSON.stringify(part)).join(" ");
}

async function run(command: readonly string[], cwd: string, debug: boolean, io: ApplicationIO): Promise<CommandResult> {
  if (debug) io.stderr(`fia: debug: ${commandText(command)}\n`);
  const child = Bun.spawn([...command], {
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function checked(
  stage: string,
  command: readonly string[],
  cwd: string,
  debug: boolean,
  io: ApplicationIO,
): Promise<string> {
  const result = await run(command, cwd, debug, io);
  if (debug && result.stdout.length > 0) io.stderr(result.stdout);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`${stage} failed: ${detail}`);
  }
  return result.stdout;
}

function assertGeneratedPath(projectRoot: string, path: string): void {
  const generatedRoot = resolve(projectRoot, ".fia");
  const absolute = resolve(path);
  const fromRoot = relative(generatedRoot, absolute);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`refusing to use a path outside .fia: ${absolute}`);
  }
}

async function existingFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveManagedRuntime(explicit?: string): Promise<string> {
  if (explicit !== undefined) return resolve(explicit);
  const candidates = [
    resolve(import.meta.dir, "runtime/managed.ts"),
    resolve(import.meta.dir, "managed-runtime.js"),
    resolve(import.meta.dir, "../src/runtime/managed.ts"),
  ];
  for (const candidate of candidates) {
    if (await existingFile(candidate)) return candidate;
  }
  throw new Error("the FIA managed runtime asset is missing; reinstall @fia/cli");
}

function defaultHostAssetDirectory(): string {
  return resolve(import.meta.dir, "../assets/host/darwin-arm64");
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

async function verifyHostAsset(directory: string, debug: boolean, io: ApplicationIO): Promise<string> {
  const executable = resolve(directory, HOST_EXECUTABLE);
  const manifestPath = resolve(directory, "manifest.json");
  let manifest: HostManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as HostManifest;
  } catch (error) {
    throw new Error(`precompiled Host manifest is missing or invalid: ${error instanceof Error ? error.message : error}`);
  }
  if (
    manifest.schemaVersion !== 1
    || manifest.cliVersion !== CLI_VERSION
    || manifest.hostVersion !== CLI_VERSION
    || manifest.architecture !== "arm64"
    || manifest.minimumSystemVersion !== "14.0"
    || manifest.runtimeProtocol !== 1
    || manifest.configurationSchemas.join(",") !== "1,2"
  ) {
    throw new Error("precompiled Host manifest is incompatible with this CLI");
  }
  await access(executable, constants.R_OK | constants.X_OK);
  if (await sha256(executable) !== manifest.sha256) throw new Error("precompiled Host checksum does not match manifest");
  const architectures = (await checked(
    "Host architecture verification",
    ["/usr/bin/lipo", "-archs", executable],
    directory,
    debug,
    io,
  )).trim();
  if (architectures !== "arm64") throw new Error(`precompiled Host architecture is ${architectures}; expected arm64`);
  return executable;
}

function generatedEntry(
  config: ResolvedFIAConfig,
  managedRuntimePath: string,
  mode: "development" | "production",
  uiPath: string,
): string {
  const application = JSON.stringify(config.entry);
  const runtime = JSON.stringify(managedRuntimePath);
  const ui = JSON.stringify(uiPath);
  if (mode === "development") {
    return `import application from ${application};\n`
      + `import page from ${ui};\n`
      + `import { startManagedRuntime } from ${runtime};\n`
      + `await startManagedRuntime({ mode: "development", application, ui: page });\n`
      + `if (import.meta.hot) import.meta.hot.accept();\n`;
  }
  return `import application from ${application};\n`
    + `import uiTemplate from ${ui} with { type: "text" };\n`
    + `import { startManagedRuntime } from ${runtime};\n`
    + `await startManagedRuntime({ mode: "production", application, uiTemplate });\n`;
}

async function validateApplication(context: BuildContext): Promise<void> {
  const validator = resolve(context.stagingRoot, "validate-entry.ts");
  await Bun.write(validator, `
    const applicationModule = await import(${JSON.stringify(pathToFileURL(context.config.entry).href)});
    const marker = Symbol.for("dev.fia.application");
    if (applicationModule.default?.[marker] !== true) {
      process.stderr.write(
        "src/server.ts must default-export defineApp({ routes, websocket }). " +
        "Direct Bun.serve() entries are not supported; import defineApp from @fia/cli/runtime.\\n"
      );
      process.exit(65);
    }
    process.exit(0);
  `);
  const result = await run([process.execPath, validator], context.config.projectRoot, context.debug, context.io);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      "application entry validation failed: src/server.ts must default-export "
        + "defineApp({ routes, websocket }). Direct Bun.serve() entries are not supported."
        + (detail.length > 0 ? `\n${detail}` : ""),
    );
  }
}

async function typecheck(context: BuildContext): Promise<void> {
  const compiler = resolve(context.config.projectRoot, "node_modules/typescript/bin/tsc");
  if (!await existingFile(compiler)) throw new Error("TypeScript is not installed; run bun install first");
  const tsconfig = resolve(context.config.projectRoot, "tsconfig.json");
  if (!await existingFile(tsconfig)) throw new Error("tsconfig.json was not found");
  await checked(
    "TypeScript typecheck",
    [process.execPath, compiler, "--noEmit", "-p", tsconfig],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

async function buildProductionUI(context: BuildContext): Promise<string> {
  const outputDirectory = resolve(context.stagingRoot, "ui");
  await mkdir(outputDirectory, { recursive: true });
  await checked(
    "UI build",
    [
      process.execPath,
      "build",
      "--compile",
      "--target=browser",
      context.config.ui,
      "--outdir",
      outputDirectory,
    ],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  const output = resolve(outputDirectory, basename(context.config.ui));
  let html = await readFile(output, "utf8");
  html = html
    .replaceAll(/<script\b/g, `<script nonce="${CSP_NONCE}"`)
    .replaceAll(/<style\b/g, `<style nonce="${CSP_NONCE}"`);
  if (!html.includes(CSP_NONCE)) throw new Error("UI build contains no script or style tags to protect with CSP");
  const template = resolve(context.stagingRoot, "ui-template.txt");
  await Bun.write(template, html);
  return template;
}

function plistEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function infoPlist(config: ResolvedFIAConfig): string {
  const name = plistEscape(config.app.name);
  const identifier = plistEscape(config.app.identifier);
  const version = plistEscape(config.app.version);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>${HOST_EXECUTABLE}</string>
  <key>CFBundleIdentifier</key><string>${identifier}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
`;
}

function hostConfiguration(
  config: ResolvedFIAConfig,
  runtime: { mode: "production" } | { mode: "development"; executable: string; arguments: string[] },
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    protocolVersion: 1,
    app: {
      name: config.app.name,
      identifier: config.app.identifier,
      quitOnLastWindowClosed: config.app.quitOnLastWindowClosed,
    },
    window: config.window,
    runtime,
  };
}

async function assembleApp(
  context: BuildContext,
  runtime: { mode: "production"; executable: string } | {
    mode: "development";
    executable: string;
    arguments: string[];
  },
): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const macOS = resolve(contents, "MacOS");
  const resources = resolve(contents, "Resources");
  const hostDestination = resolve(macOS, HOST_EXECUTABLE);
  await mkdir(macOS, { recursive: true });
  await mkdir(resources, { recursive: true });

  const hostSource = await verifyHostAsset(context.hostAssetDirectory, context.debug, context.io);
  await copyFile(hostSource, hostDestination);
  await chmod(hostDestination, 0o755);
  let runtimeDestination: string | undefined;
  if (runtime.mode === "production") {
    runtimeDestination = resolve(macOS, RUNTIME_EXECUTABLE);
    await copyFile(runtime.executable, runtimeDestination);
    await chmod(runtimeDestination, 0o755);
  }

  await Promise.all([
    Bun.write(resolve(contents, "Info.plist"), infoPlist(context.config)),
    Bun.write(resolve(contents, "PkgInfo"), "APPL????"),
    Bun.write(
      resolve(resources, "fia-config.json"),
      `${JSON.stringify(hostConfiguration(
        context.config,
        runtime.mode === "production"
          ? { mode: "production" }
          : { mode: "development", executable: runtime.executable, arguments: runtime.arguments },
      ), null, 2)}\n`,
    ),
  ]);

  if (runtimeDestination !== undefined) {
    await checked("Runtime signing", ["/usr/bin/codesign", "--force", "--sign", "-", runtimeDestination], context.config.projectRoot, context.debug, context.io);
  }
  await checked("Host signing", ["/usr/bin/codesign", "--force", "--sign", "-", hostDestination], context.config.projectRoot, context.debug, context.io);
  await checked("application signing", ["/usr/bin/codesign", "--force", "--sign", "-", context.appPath], context.config.projectRoot, context.debug, context.io);
  await verifyApp(context, runtime.mode);
}

async function plistValue(plist: string, key: string, context: BuildContext): Promise<string> {
  return (await checked(
    `Info.plist ${key} verification`,
    ["/usr/bin/plutil", "-extract", key, "raw", "-o", "-", plist],
    context.config.projectRoot,
    context.debug,
    context.io,
  )).trim();
}

async function verifyApp(context: BuildContext, mode: "development" | "production"): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const host = resolve(contents, "MacOS", HOST_EXECUTABLE);
  const plist = resolve(contents, "Info.plist");
  const configuration = resolve(contents, "Resources/fia-config.json");
  await Promise.all([
    access(host, constants.X_OK),
    access(plist, constants.R_OK),
    access(configuration, constants.R_OK),
  ]);
  const expected = new Map([
    ["CFBundleIdentifier", context.config.app.identifier],
    ["CFBundleExecutable", HOST_EXECUTABLE],
    ["CFBundlePackageType", "APPL"],
    ["CFBundleShortVersionString", context.config.app.version],
    ["LSMinimumSystemVersion", "14.0"],
  ]);
  for (const [key, value] of expected) {
    if (await plistValue(plist, key, context) !== value) throw new Error(`Info.plist ${key} verification failed`);
  }
  const executables = [host];
  if (mode === "production") {
    const runtime = resolve(contents, "MacOS", RUNTIME_EXECUTABLE);
    await access(runtime, constants.X_OK);
    executables.push(runtime);
  }
  for (const executable of executables) {
    const architectures = (await checked(
      "application architecture verification",
      ["/usr/bin/lipo", "-archs", executable],
      context.config.projectRoot,
      context.debug,
      context.io,
    )).trim();
    if (architectures !== "arm64") throw new Error(`${basename(executable)} architecture is ${architectures}; expected arm64`);
  }
  await checked(
    "application signature verification",
    ["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

async function productionApp(context: BuildContext): Promise<void> {
  const uiTemplate = await buildProductionUI(context);
  const entry = resolve(context.stagingRoot, "runtime-entry.ts");
  await Bun.write(entry, generatedEntry(context.config, context.managedRuntimePath, "production", uiTemplate));
  const runtime = resolve(context.stagingRoot, RUNTIME_EXECUTABLE);
  await checked(
    "Runtime build",
    [
      process.execPath,
      "build",
      "--compile",
      "--target=bun-darwin-arm64",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      entry,
      "--outfile",
      runtime,
    ],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await assembleApp(context, { mode: "production", executable: runtime });
}

async function developmentApp(context: BuildContext): Promise<void> {
  const entry = resolve(context.stagingRoot, "runtime-entry.ts");
  await Bun.write(entry, generatedEntry(context.config, context.managedRuntimePath, "development", context.config.ui));
  await assembleApp(context, {
    mode: "development",
    executable: process.execPath,
    arguments: ["--hot", "--no-clear-screen", entry],
  });
}

async function streamToIO(stream: ReadableStream<Uint8Array>, sink: (value: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      sink(decoder.decode(result.value, { stream: true }));
    }
    const trailing = decoder.decode();
    if (trailing.length > 0) sink(trailing);
  } finally {
    reader.releaseLock();
  }
}

async function launchHost(context: BuildContext): Promise<void> {
  const executable = resolve(context.appPath, "Contents/MacOS", HOST_EXECUTABLE);
  context.io.stdout(`Launching ${context.config.app.name}\n`);
  const child = Bun.spawn([executable], {
    cwd: context.config.projectRoot,
    env: { ...process.env, FIA_INTERNAL_DIAGNOSTICS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let interruptCount = 0;
  const forward = (signal: NodeJS.Signals): void => {
    interruptCount += 1;
    if (interruptCount === 1) child.kill(signal);
    else child.kill("SIGKILL");
  };
  const interrupt = (): void => forward("SIGINT");
  const terminate = (): void => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const [exitCode] = await Promise.all([
      child.exited,
      streamToIO(child.stdout, context.io.stdout),
      streamToIO(child.stderr, context.io.stderr),
    ]);
    if (exitCode !== 0) throw new Error(`Host exited with status ${exitCode}`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

async function replaceDistribution(context: BuildContext): Promise<string> {
  const distribution = resolve(context.config.projectRoot, "dist");
  const destination = resolve(distribution, `${context.config.app.name}.app`);
  const previous = resolve(context.stagingRoot, "previous.app");
  await mkdir(distribution, { recursive: true });
  const hadPrevious = await pathExists(destination);
  if (hadPrevious) await rename(destination, previous);
  try {
    await rename(context.appPath, destination);
    const destinationContext = { ...context, appPath: destination };
    await verifyApp(destinationContext, "production");
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    if (hadPrevious && await Bun.file(resolve(previous, "Contents/Info.plist")).exists()) {
      await rename(previous, destination);
    }
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  return destination;
}

export async function executeApplicationCommand(options: ApplicationCommandOptions): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("fia dev/build/run require macOS on Apple Silicon");
  }
  if (Bun.version !== BUN_VERSION) throw new Error(`FIA requires Bun ${BUN_VERSION}; found ${Bun.version}`);

  const config = await loadProjectConfig(options.cwd);
  const buildID = `${Date.now()}-${crypto.randomUUID()}`;
  const stagingRoot = resolve(config.projectRoot, `.fia/${options.command}/${buildID}`);
  const appPath = resolve(stagingRoot, `${config.app.name}.app`);
  assertGeneratedPath(config.projectRoot, stagingRoot);
  assertGeneratedPath(config.projectRoot, appPath);
  const context: BuildContext = {
    config,
    stagingRoot,
    appPath,
    managedRuntimePath: await resolveManagedRuntime(options.dependencies?.managedRuntimePath),
    hostAssetDirectory: resolve(options.dependencies?.hostAssetDirectory ?? defaultHostAssetDirectory()),
    debug: options.debug,
    io: options.io,
  };

  await mkdir(stagingRoot, { recursive: true });
  try {
    options.io.stdout(`Validating ${config.app.name}\n`);
    await typecheck(context);
    await validateApplication(context);
    if (options.command === "dev") {
      await developmentApp(context);
      await launchHost(context);
      return;
    }

    await productionApp(context);
    if (options.command === "run") {
      await launchHost(context);
      return;
    }
    const destination = await replaceDistribution(context);
    options.io.stdout(`Built ${destination}\n`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
