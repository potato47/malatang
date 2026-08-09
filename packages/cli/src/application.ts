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
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isBunVersionSupported, MINIMUM_BUN_VERSION } from "./bun-version.ts";
import { CLI_VERSION } from "./metadata.ts";
import { loadProjectConfig, type ResolvedFIAConfig } from "./project-config.ts";

export interface ApplicationIO {
  stdout(value: string): void;
  stderr(value: string): void;
}

export type ApplicationCommand = "dev" | "build" | "run";

export interface ApplicationCommandDependencies {
  hostAssetDirectory?: string;
}

export interface ApplicationCommandOptions {
  command: ApplicationCommand;
  cwd: string;
  debug: boolean;
  io: ApplicationIO;
  dependencies?: ApplicationCommandDependencies;
}

interface HostManifest {
  schemaVersion: 3;
  cliVersion: string;
  hostVersion: string;
  sha256: string;
  architecture: "arm64";
  minimumSystemVersion: "14.0";
  configurationSchema: 6;
  stdioProtocol: 1;
  hostCapabilities: readonly ["application", "statusItem", "webviews", "system"];
}

interface BuildContext {
  config: ResolvedFIAConfig;
  stagingRoot: string;
  appPath: string;
  hostAssetDirectory: string;
  debug: boolean;
  io: ApplicationIO;
}

interface BackendArtifact {
  executable: string;
  arguments: readonly string[];
  sha256: string;
  development: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HOST_EXECUTABLE = "FIAHost";
const BACKEND_EXECUTABLE = "FIABackend";
const HOST_CAPABILITIES = ["application", "statusItem", "webviews", "system"] as const;

function commandText(command: readonly string[]): string {
  return command.map((part) => JSON.stringify(part)).join(" ");
}

async function run(
  command: readonly string[],
  cwd: string,
  debug: boolean,
  io: ApplicationIO,
): Promise<CommandResult> {
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function existingFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function assertGeneratedPath(projectRoot: string, path: string): void {
  const generatedRoot = resolve(projectRoot, ".fia");
  const fromRoot = relative(generatedRoot, resolve(path));
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`refusing to use a path outside .fia: ${path}`);
  }
}

function defaultHostAssetDirectory(): string {
  return resolve(import.meta.dir, "../assets/host/darwin-arm64");
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

async function verifyArm64MachO(
  label: string,
  executable: string,
  context: BuildContext,
): Promise<void> {
  await access(executable, constants.R_OK | constants.X_OK);
  const architectures = (
    await checked(
      `${label} architecture verification`,
      ["/usr/bin/lipo", "-archs", executable],
      context.config.projectRoot,
      context.debug,
      context.io,
    )
  ).trim();
  if (architectures !== "arm64")
    throw new Error(`${label} architecture is ${architectures}; expected arm64`);
  const kind = (
    await checked(
      `${label} Mach-O verification`,
      ["/usr/bin/file", "-b", executable],
      context.config.projectRoot,
      context.debug,
      context.io,
    )
  ).trim();
  if (!kind.includes("Mach-O") || !kind.includes("arm64")) {
    throw new Error(`${label} is not an arm64 Mach-O executable`);
  }
}

async function verifyHostAsset(context: BuildContext): Promise<string> {
  const executable = resolve(context.hostAssetDirectory, HOST_EXECUTABLE);
  const manifestPath = resolve(context.hostAssetDirectory, "manifest.json");
  let manifest: HostManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as HostManifest;
  } catch (error) {
    throw new Error(
      `precompiled Host manifest is missing or invalid: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (
    manifest.schemaVersion !== 3 ||
    manifest.cliVersion !== CLI_VERSION ||
    manifest.hostVersion !== CLI_VERSION ||
    manifest.architecture !== "arm64" ||
    manifest.minimumSystemVersion !== "14.0" ||
    manifest.configurationSchema !== 6 ||
    manifest.stdioProtocol !== 1 ||
    manifest.hostCapabilities.join(",") !== HOST_CAPABILITIES.join(",")
  ) {
    throw new Error("precompiled Host manifest is incompatible with this CLI");
  }
  if ((await sha256(executable)) !== manifest.sha256) {
    throw new Error("precompiled Host checksum does not match manifest");
  }
  await verifyArm64MachO("Host", executable, context);
  return executable;
}

async function typecheck(context: BuildContext): Promise<void> {
  const compiler = resolve(context.config.projectRoot, "node_modules/typescript/bin/tsc");
  if (!(await existingFile(compiler)))
    throw new Error("TypeScript is not installed; run bun install first");
  const tsconfig = resolve(context.config.projectRoot, "tsconfig.json");
  if (!(await existingFile(tsconfig))) throw new Error("tsconfig.json was not found");
  await checked(
    "TypeScript typecheck",
    [process.execPath, compiler, "--noEmit", "-p", tsconfig],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

export function generatedBackendRunner(entry: string): string {
  const absoluteEntry = resolve(entry);
  return `
    import { isDefinedBackend, runBackend } from "@semicoder/fia/backend";
    const writeLog = (...values) => process.stderr.write(values.map((value) => typeof value === "string" ? value : Bun.inspect(value)).join(" ") + "\\n");
    console.log = writeLog;
    console.info = writeLog;
    console.debug = writeLog;
    console.warn = writeLog;
    console.error = writeLog;
    const module = await import(${JSON.stringify(absoluteEntry)});
    if (!isDefinedBackend(module.default)) {
      process.stderr.write("Backend entry must default-export defineBackend({...}).\\n");
      process.exit(65);
    }
    await runBackend(module.default);
  `;
}

async function writeBackendRunner(context: BuildContext): Promise<string> {
  const runner = resolve(context.stagingRoot, "backend-runner.ts");
  await Bun.write(runner, generatedBackendRunner(context.config.backend.entry));
  return runner;
}

async function validateBackend(context: BuildContext, runner: string): Promise<void> {
  const validator = resolve(context.stagingRoot, "validate-backend.ts");
  await Bun.write(
    validator,
    `import backend from ${JSON.stringify(pathToFileURL(context.config.backend.entry).href)};\n` +
      `import { isDefinedBackend } from "@semicoder/fia/backend";\n` +
      `if (!isDefinedBackend(backend)) throw new Error("Backend entry must default-export defineBackend({...})");\n`,
  );
  await checked(
    "Backend definition validation",
    [process.execPath, validator],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await checked(
    "Backend runner validation",
    [
      process.execPath,
      "build",
      "--target=bun",
      runner,
      "--outdir",
      resolve(context.stagingRoot, "runner-check"),
    ],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

function fakeNativeResult(method: string, params: Record<string, unknown>): unknown {
  if (
    method === "application.getState" ||
    method === "application.setDockVisible" ||
    method === "statusItem.setVisible"
  ) {
    return { dockVisible: params.visible === true, statusItemVisible: true };
  }
  if (method === "webviews.list") return [];
  if (method.startsWith("webviews.") && method !== "webviews.close") {
    return {
      id: typeof params.id === "string" ? params.id : "main",
      url: typeof params.url === "string" ? params.url : "http://127.0.0.1/",
      title: typeof params.title === "string" ? params.title : "FIA",
      visible: true,
      focused: true,
      alwaysOnTop: false,
      visibleOnAllSpaces: false,
      visibleOverFullScreen: false,
    };
  }
  return null;
}

async function smokeBackend(context: BuildContext, executable: string): Promise<void> {
  const child = Bun.spawn([executable], {
    cwd: context.config.projectRoot,
    env: {},
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const input = child.stdin;
  if (typeof input === "number" || input === undefined)
    throw new Error("Backend smoke stdin is unavailable");
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ready: { port: number; origin: string } | undefined;
  input.write(
    `${JSON.stringify({
      v: 1,
      type: "initialize",
      sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
      preferredPort: 0,
      development: false,
      applicationSupport: resolve(context.stagingRoot, "smoke-support"),
      app: { name: context.config.app.name, identifier: context.config.app.identifier },
    })}\n`,
  );
  input.flush();
  const deadline = Date.now() + 10_000;
  try {
    while (ready === undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Backend readiness timed out");
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Backend readiness timed out")), remaining),
        ),
      ]);
      if (result.done) throw new Error("Backend exited before ready");
      buffer += decoder.decode(result.value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const frame = JSON.parse(line) as {
          type?: string;
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          port?: number;
          origin?: string;
        };
        if (
          frame.type === "request" &&
          typeof frame.id === "number" &&
          typeof frame.method === "string"
        ) {
          input.write(
            `${JSON.stringify({
              v: 1,
              type: "response",
              id: frame.id,
              result: fakeNativeResult(frame.method, frame.params ?? {}),
            })}\n`,
          );
          input.flush();
        } else if (
          frame.type === "ready" &&
          typeof frame.port === "number" &&
          typeof frame.origin === "string"
        ) {
          ready = { port: frame.port, origin: frame.origin };
        } else {
          throw new Error("Backend emitted an invalid smoke-test frame");
        }
      }
    }
    const health = await fetch(`${ready.origin}/_fia/health`);
    if (health.status !== 204) throw new Error(`Backend health check returned ${health.status}`);
    input.write(`${JSON.stringify({ v: 1, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    const exitCode = await Promise.race([
      child.exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Backend shutdown timed out")), 5_000),
      ),
    ]);
    if (exitCode !== 0) throw new Error(`Backend smoke test exited with status ${exitCode}`);
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL");
    const diagnostic = (await stderr).trim();
    throw new Error(
      `Backend startup smoke test failed${diagnostic.length > 0 ? `: ${diagnostic}` : ""}`,
      {
        cause: error,
      },
    );
  } finally {
    reader.releaseLock();
    input.end();
  }
}

async function buildProductionBackend(
  context: BuildContext,
  runner: string,
): Promise<BackendArtifact> {
  const executable = resolve(context.stagingRoot, BACKEND_EXECUTABLE);
  await checked(
    "Backend standalone build",
    [
      process.execPath,
      "build",
      "--compile",
      "--target=bun-darwin-arm64",
      "--minify",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      runner,
      "--outfile",
      executable,
    ],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await chmod(executable, 0o755);
  await verifyArm64MachO("Backend", executable, context);
  await smokeBackend(context, executable);
  return { executable, arguments: [], sha256: await sha256(executable), development: false };
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
  const icon =
    config.app.icon === undefined ? "" : "  <key>CFBundleIconFile</key><string>AppIcon</string>\n";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${plistEscape(config.app.name)}</string>
  <key>CFBundleExecutable</key><string>${HOST_EXECUTABLE}</string>
  <key>CFBundleIdentifier</key><string>${plistEscape(config.app.identifier)}</string>
${icon}  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${plistEscape(config.app.name)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${plistEscape(config.app.version)}</string>
  <key>CFBundleVersion</key><string>${plistEscape(config.app.version)}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
`;
}

function hostConfiguration(
  config: ResolvedFIAConfig,
  backend: BackendArtifact,
): Record<string, unknown> {
  return {
    schemaVersion: 6,
    stdioProtocolVersion: 1,
    development: backend.development,
    app: { name: config.app.name, identifier: config.app.identifier },
    statusItem: config.statusBar,
    backend: {
      executable: backend.development ? backend.executable : `Helpers/${BACKEND_EXECUTABLE}`,
      arguments: backend.arguments,
      sha256: backend.sha256,
    },
    hostCapabilities: HOST_CAPABILITIES,
  };
}

async function assembleApp(context: BuildContext, backend: BackendArtifact): Promise<void> {
  const host = await verifyHostAsset(context);
  const contents = resolve(context.appPath, "Contents");
  const macOS = resolve(contents, "MacOS");
  const helpers = resolve(contents, "Helpers");
  const resources = resolve(contents, "Resources");
  await mkdir(macOS, { recursive: true });
  await mkdir(helpers, { recursive: true });
  await mkdir(resources, { recursive: true });
  await copyFile(host, resolve(macOS, HOST_EXECUTABLE));
  await chmod(resolve(macOS, HOST_EXECUTABLE), 0o755);
  if (!backend.development) {
    await copyFile(backend.executable, resolve(helpers, BACKEND_EXECUTABLE));
    await chmod(resolve(helpers, BACKEND_EXECUTABLE), 0o755);
  }
  if (context.config.app.icon !== undefined) {
    await copyFile(context.config.app.icon, resolve(resources, "AppIcon.icns"));
  }
  await Bun.write(resolve(contents, "Info.plist"), infoPlist(context.config));
  let configuredBackend = backend;
  if (!backend.development) {
    await checked(
      "Backend signing",
      ["/usr/bin/codesign", "--force", "--sign", "-", resolve(helpers, BACKEND_EXECUTABLE)],
      context.config.projectRoot,
      context.debug,
      context.io,
    );
    configuredBackend = {
      ...backend,
      sha256: await sha256(resolve(helpers, BACKEND_EXECUTABLE)),
    };
  }
  await Bun.write(
    resolve(resources, "fia-config.json"),
    `${JSON.stringify(hostConfiguration(context.config, configuredBackend), null, 2)}\n`,
  );
  await checked(
    "Application signing",
    ["/usr/bin/codesign", "--force", "--sign", "-", "--deep", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await verifyApp(context, !backend.development);
}

async function verifyApp(context: BuildContext, production: boolean): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const configuration = JSON.parse(
    await readFile(resolve(contents, "Resources/fia-config.json"), "utf8"),
  ) as Record<string, unknown>;
  if (configuration.schemaVersion !== 6 || configuration.stdioProtocolVersion !== 1) {
    throw new Error("packaged Host configuration is incompatible");
  }
  if (production) {
    const executable = resolve(contents, "Helpers", BACKEND_EXECUTABLE);
    await access(executable, constants.R_OK | constants.X_OK);
    const backend = configuration.backend as { sha256?: unknown };
    if (typeof backend.sha256 !== "string" || (await sha256(executable)) !== backend.sha256) {
      throw new Error("packaged Backend checksum does not match");
    }
    await checked(
      "Backend signature verification",
      ["/usr/bin/codesign", "--verify", "--strict", executable],
      context.config.projectRoot,
      context.debug,
      context.io,
    );
  }
  for (const removed of ["UI", "MCPServers"]) {
    if (await pathExists(resolve(contents, removed === "UI" ? "Resources" : "Helpers", removed))) {
      throw new Error(`removed packaged directory unexpectedly exists: ${removed}`);
    }
  }
  await checked(
    "Application signature verification",
    ["/usr/bin/codesign", "--verify", "--strict", "--deep", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

async function streamToIO(
  stream: ReadableStream<Uint8Array>,
  sink: (value: string) => void,
): Promise<void> {
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
    child.kill(interruptCount === 1 ? signal : "SIGKILL");
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

async function developmentBackend(context: BuildContext, runner: string): Promise<BackendArtifact> {
  return {
    executable: process.execPath,
    arguments: ["--hot", "--no-clear-screen", runner],
    sha256: await sha256(process.execPath),
    development: true,
  };
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
    await verifyApp({ ...context, appPath: destination }, true);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    if (hadPrevious && (await existingFile(resolve(previous, "Contents/Info.plist")))) {
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
  if (!isBunVersionSupported(Bun.version)) {
    throw new Error(`FIA requires Bun ${MINIMUM_BUN_VERSION} or newer; found ${Bun.version}`);
  }
  const config = await loadProjectConfig(options.cwd);
  const stagingRoot = resolve(
    config.projectRoot,
    `.fia/${options.command}/${Date.now()}-${crypto.randomUUID()}`,
  );
  const appPath = resolve(stagingRoot, `${config.app.name}.app`);
  assertGeneratedPath(config.projectRoot, stagingRoot);
  assertGeneratedPath(config.projectRoot, appPath);
  const context: BuildContext = {
    config,
    stagingRoot,
    appPath,
    hostAssetDirectory: resolve(
      options.dependencies?.hostAssetDirectory ?? defaultHostAssetDirectory(),
    ),
    debug: options.debug,
    io: options.io,
  };
  await mkdir(stagingRoot, { recursive: true });
  try {
    options.io.stdout(`Validating ${config.app.name}\n`);
    await typecheck(context);
    const runner = await writeBackendRunner(context);
    await validateBackend(context, runner);
    if (options.command === "dev") {
      await assembleApp(context, await developmentBackend(context, runner));
      await launchHost(context);
      return;
    }
    await assembleApp(context, await buildProductionBackend(context, runner));
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
