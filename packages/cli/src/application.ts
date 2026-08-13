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

export type ApplicationCommand = "dev" | "build" | "package" | "release" | "run";

export interface ApplicationCommandDependencies {
  hostAssetDirectory?: string;
}

export interface DevelopmentAutomationOptions {
  readonly printSessionURL?: boolean;
  readonly emitAction?: string;
}

export interface ApplicationCommandOptions {
  command: ApplicationCommand;
  cwd: string;
  debug: boolean;
  io: ApplicationIO;
  dependencies?: ApplicationCommandDependencies;
  developmentAutomation?: DevelopmentAutomationOptions;
}

interface HostManifest {
  schemaVersion: 3;
  cliVersion: string;
  hostVersion: string;
  sha256: string;
  architecture: "arm64";
  minimumSystemVersion: "14.0";
  configurationSchema: 8;
  stdioProtocol: 2;
  hostCapabilities: readonly [
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
  ];
}

interface BuildContext {
  command: ApplicationCommand;
  config: ResolvedFIAConfig;
  stagingRoot: string;
  appPath: string;
  hostAssetDirectory: string;
  signingIdentity: string;
  distribution: boolean;
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
const HOST_CAPABILITIES = [
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
] as const;

export function hasExpectedHostCapabilities(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === HOST_CAPABILITIES.length &&
    value.every((capability, index) => capability === HOST_CAPABILITIES[index])
  );
}

interface CodeSigningIdentity {
  readonly name: string;
}

export function parseCodeSigningIdentities(output: string): readonly CodeSigningIdentity[] {
  const identities: CodeSigningIdentity[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(.*)"\s*$/.exec(line);
    if (match !== null) identities.push({ name: match[2]! });
  }
  return identities;
}

export function hasCodeSigningIdentity(output: string, identity: string): boolean {
  return parseCodeSigningIdentities(output).some((candidate) => candidate.name === identity);
}

export function codeSigningCommand(
  identity: string,
  path: string,
  options: { distribution?: boolean; entitlements?: string } = {},
): readonly string[] {
  return [
    "/usr/bin/codesign",
    "--force",
    "--sign",
    identity,
    ...(options.distribution === true ? ["--options", "runtime", "--timestamp"] : []),
    ...(options.entitlements === undefined ? [] : ["--entitlements", options.entitlements]),
    path,
  ];
}

export function distributionArchiveName(config: {
  readonly app: { readonly name: string; readonly version: string };
}): string {
  return `${config.app.name}-${config.app.version}-mac-arm64.zip`;
}

export function distributionArchiveCommand(
  appPath: string,
  archivePath: string,
): readonly string[] {
  return ["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archivePath];
}

export function notarizationSubmitCommand(
  archivePath: string,
  keychainProfile: string,
): readonly string[] {
  return [
    "/usr/bin/xcrun",
    "notarytool",
    "submit",
    archivePath,
    "--keychain-profile",
    keychainProfile,
    "--wait",
    "--timeout",
    "60m",
    "--output-format",
    "json",
  ];
}

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

export function backendDistributionEntitlements(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
`;
}

async function writeBackendDistributionEntitlements(context: BuildContext): Promise<string> {
  const path = resolve(context.stagingRoot, "backend-distribution.entitlements");
  await Bun.write(path, backendDistributionEntitlements());
  return path;
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
    manifest.configurationSchema !== 8 ||
    manifest.stdioProtocol !== 2 ||
    !hasExpectedHostCapabilities(manifest.hostCapabilities)
  ) {
    throw new Error("precompiled Host manifest is incompatible with this CLI");
  }
  if ((await sha256(executable)) !== manifest.sha256) {
    throw new Error("precompiled Host checksum does not match manifest");
  }
  await verifyArm64MachO("Host", executable, context);
  return executable;
}

async function verifySigningIdentity(context: BuildContext): Promise<void> {
  const identity = context.signingIdentity;
  if (identity === "-") {
    context.io.stderr(
      "fia: warning: signing.identity is not configured; using ad-hoc signing. " +
        "macOS privacy permissions may reset after rebuilding the application.\n",
    );
    return;
  }
  const output = await checked(
    "Code signing identity validation",
    ["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  if (!hasCodeSigningIdentity(output, identity)) {
    throw new Error(`configured code signing identity was not found: ${identity}`);
  }
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
      process.stderr.write("Backend entry must default-export defineBackend()({...}).\\n");
      process.exit(65);
    }
    await runBackend(module.default);
  `;
}

export function developmentBackendRunnerPath(projectRoot: string): string {
  return resolve(projectRoot, ".fia/dev/backend-runner.ts");
}

async function writeBackendRunner(context: BuildContext): Promise<string> {
  const runner =
    context.command === "dev"
      ? developmentBackendRunnerPath(context.config.projectRoot)
      : resolve(context.stagingRoot, "backend-runner.ts");
  await Bun.write(runner, generatedBackendRunner(context.config.backend.entry));
  return runner;
}

async function validateBackend(context: BuildContext, runner: string): Promise<void> {
  const validator = resolve(context.stagingRoot, "validate-backend.ts");
  await Bun.write(
    validator,
    `import backend from ${JSON.stringify(pathToFileURL(context.config.backend.entry).href)};\n` +
      `import { isDefinedBackend } from "@semicoder/fia/backend";\n` +
      `if (!isDefinedBackend(backend)) throw new Error("Backend entry must default-export defineBackend()({...})");\n`,
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

async function staticBuildPlugins(projectRoot: string): Promise<string[]> {
  const bunfig = resolve(projectRoot, "bunfig.toml");
  if (!(await existingFile(bunfig))) return [];
  const config = Bun.TOML.parse(await readFile(bunfig, "utf8")) as {
    serve?: { static?: { plugins?: unknown } };
  };
  const plugins = config.serve?.static?.plugins;
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins) || plugins.some((plugin) => typeof plugin !== "string")) {
    throw new Error("bunfig.toml serve.static.plugins must be an array of package names");
  }
  return plugins as string[];
}

function generatedStandaloneBuild(
  projectRoot: string,
  runner: string,
  executable: string,
  pluginSpecifiers: readonly string[],
): string {
  return `
    const pluginSpecifiers = ${JSON.stringify(pluginSpecifiers)};
    const plugins = await Promise.all(pluginSpecifiers.map(async (specifier) => {
      const module = await import(specifier);
      const plugin = module.default ?? module;
      if (typeof plugin?.setup !== "function") {
        throw new Error(\`Build plugin \${specifier} does not export a Bun plugin\`);
      }
      return plugin;
    }));
    const result = await Bun.build({
      entrypoints: [${JSON.stringify(runner)}],
      target: "bun",
      root: ${JSON.stringify(projectRoot)},
      minify: true,
      plugins,
      throw: false,
      compile: {
        target: "bun-darwin-arm64",
        outfile: ${JSON.stringify(executable)},
        autoloadDotenv: false,
        autoloadBunfig: false,
      },
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  `;
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
      windowStyle: typeof params.windowStyle === "string" ? params.windowStyle : "native",
      transparent: params.transparent === true,
      shadow: params.shadow !== false,
      resizable: params.resizable !== false,
      dragRegion: params.dragRegion ?? null,
      frame: {
        x: typeof params.x === "number" ? params.x : 0,
        y: typeof params.y === "number" ? params.y : 0,
        width: typeof params.width === "number" ? params.width : 1024,
        height: typeof params.height === "number" ? params.height : 700,
      },
      alwaysOnTop: false,
      visibleOnAllSpaces: false,
      visibleOverFullScreen: false,
    };
  }
  if (
    method === "notifications.getAuthorizationStatus" ||
    method === "notifications.requestAuthorization"
  ) {
    return "authorized";
  }
  if (method === "notifications.send") {
    return { id: typeof params.id === "string" ? params.id : "smoke-notification" };
  }
  if (method === "screens.list") {
    return [
      {
        id: "main",
        name: "Main Display",
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        visibleFrame: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 2,
        main: true,
        containsPointer: true,
      },
    ];
  }
  if (
    method === "screenCapture.getAuthorizationStatus" ||
    method === "screenCapture.requestAuthorization"
  ) {
    return "authorized";
  }
  if (method === "screenCapture.capture") {
    return {
      path: params.destination,
      pixelWidth: 1920,
      pixelHeight: 1080,
    };
  }
  if (method === "system.trashPath") return params.path;
  if (method.startsWith("dialogs.")) return null;
  if (method === "clipboard.readText" || method === "keychain.get") return null;
  if (method === "keychain.delete") return false;
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
      v: 2,
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
              v: 2,
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
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
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
  const builder = resolve(context.stagingRoot, "build-backend.ts");
  await Bun.write(
    builder,
    generatedStandaloneBuild(
      context.config.projectRoot,
      runner,
      executable,
      await staticBuildPlugins(context.config.projectRoot),
    ),
  );
  await checked(
    "Backend standalone build",
    [process.execPath, builder],
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
    schemaVersion: 8,
    stdioProtocolVersion: 2,
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
    const entitlements = context.distribution
      ? await writeBackendDistributionEntitlements(context)
      : undefined;
    await checked(
      "Backend signing",
      codeSigningCommand(context.signingIdentity, resolve(helpers, BACKEND_EXECUTABLE), {
        distribution: context.distribution,
        ...(entitlements === undefined ? {} : { entitlements }),
      }),
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
    codeSigningCommand(context.signingIdentity, context.appPath, {
      distribution: context.distribution,
    }),
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await verifyApp(context, !backend.development);
  if (context.distribution) {
    await verifyDistributionCodeSignature(context, "Backend", resolve(helpers, BACKEND_EXECUTABLE));
    await verifyDistributionCodeSignature(context, "Application", context.appPath);
  }
}

async function verifyApp(context: BuildContext, production: boolean): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const configuration = JSON.parse(
    await readFile(resolve(contents, "Resources/fia-config.json"), "utf8"),
  ) as Record<string, unknown>;
  if (configuration.schemaVersion !== 8 || configuration.stdioProtocolVersion !== 2) {
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

async function launchHost(
  context: BuildContext,
  developmentAutomation?: DevelopmentAutomationOptions,
): Promise<void> {
  const executable = resolve(context.appPath, "Contents/MacOS", HOST_EXECUTABLE);
  context.io.stdout(`Launching ${context.config.app.name}\n`);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FIA_INTERNAL_DIAGNOSTICS: "1",
  };
  delete environment.FIA_INTERNAL_PRINT_SESSION_URL;
  delete environment.FIA_INTERNAL_EMIT_ACTION;
  if (developmentAutomation?.printSessionURL === true) {
    environment.FIA_INTERNAL_PRINT_SESSION_URL = "1";
  }
  if (developmentAutomation?.emitAction !== undefined) {
    environment.FIA_INTERNAL_EMIT_ACTION = developmentAutomation.emitAction;
  }
  const child = Bun.spawn([executable], {
    cwd: context.config.projectRoot,
    env: environment,
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

export interface NotarizationResponse {
  readonly id?: string;
  readonly status?: string;
  readonly message?: string;
}

export function parseNotarizationResponse(value: string): NotarizationResponse {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    const object = parsed as Record<string, unknown>;
    return {
      ...(typeof object.id === "string" ? { id: object.id } : {}),
      ...(typeof object.status === "string" ? { status: object.status } : {}),
      ...(typeof object.message === "string" ? { message: object.message } : {}),
    };
  } catch (error) {
    throw new Error(
      `notarytool returned invalid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function verifyDistributionCodeSignature(
  context: BuildContext,
  label: string,
  path: string,
): Promise<void> {
  const command = ["/usr/bin/codesign", "-d", "--verbose=4", path] as const;
  const result = await run(command, context.config.projectRoot, context.debug, context.io);
  const detail = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0) {
    throw new Error(`${label} distribution signature inspection failed: ${detail.trim()}`);
  }
  if (!/\bflags=.*\bruntime\b/m.test(detail)) {
    throw new Error(`${label} distribution signature does not enable the hardened runtime`);
  }
  if (!/^Timestamp=.+$/m.test(detail)) {
    throw new Error(`${label} distribution signature does not include a secure timestamp`);
  }
}

async function createDistributionArchive(
  context: BuildContext,
  archivePath: string,
): Promise<void> {
  await checked(
    "Distribution archive creation",
    distributionArchiveCommand(context.appPath, archivePath),
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

async function notarizeApplication(
  context: BuildContext,
  submissionArchive: string,
): Promise<void> {
  const keychainProfile = context.config.release?.notarization?.keychainProfile;
  if (keychainProfile === undefined) {
    throw new Error(
      "release.notarization.keychainProfile is required for fia release; " +
        "create one with xcrun notarytool store-credentials",
    );
  }
  const command = notarizationSubmitCommand(submissionArchive, keychainProfile);
  const result = await run(command, context.config.projectRoot, context.debug, context.io);
  if (context.debug && result.stdout.length > 0) context.io.stderr(result.stdout);
  let response: NotarizationResponse | undefined;
  if (result.stdout.trim().length > 0) response = parseNotarizationResponse(result.stdout);
  if (result.exitCode !== 0 || response?.status !== "Accepted") {
    let detail =
      typeof response?.message === "string"
        ? response.message
        : result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    if (typeof response?.id === "string") {
      const log = await run(
        ["/usr/bin/xcrun", "notarytool", "log", response.id, "--keychain-profile", keychainProfile],
        context.config.projectRoot,
        context.debug,
        context.io,
      );
      const logDetail = log.stdout.trim() || log.stderr.trim();
      if (logDetail.length > 0) detail = `${detail}\n${logDetail}`;
    }
    throw new Error(`Notarization failed: ${detail}`);
  }
  await checked(
    "Notarization ticket stapling",
    ["/usr/bin/xcrun", "stapler", "staple", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await checked(
    "Notarization ticket validation",
    ["/usr/bin/xcrun", "stapler", "validate", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await verifyApp(context, true);
  await checked(
    "Gatekeeper assessment",
    ["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
}

async function publishDistributionArchive(
  context: BuildContext,
  archivePath: string,
): Promise<string> {
  const distribution = resolve(context.config.projectRoot, "dist");
  const name = distributionArchiveName(context.config);
  const destination = resolve(distribution, name);
  const stagedChecksum = `${archivePath}.sha256`;
  await Bun.write(stagedChecksum, `${await sha256(archivePath)}  ${name}\n`);
  await mkdir(distribution, { recursive: true });
  await rename(archivePath, destination);
  await rename(stagedChecksum, `${destination}.sha256`);
  return destination;
}

async function buildDistribution(context: BuildContext): Promise<string> {
  if (context.command === "release") {
    const submissionArchive = resolve(context.stagingRoot, "notary-submission.zip");
    await createDistributionArchive(context, submissionArchive);
    await notarizeApplication(context, submissionArchive);
  }
  const archive = resolve(context.stagingRoot, distributionArchiveName(context.config));
  await createDistributionArchive(context, archive);
  return await publishDistributionArchive(context, archive);
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
    throw new Error("FIA application commands require macOS on Apple Silicon");
  }
  if (!isBunVersionSupported(Bun.version)) {
    throw new Error(`FIA requires Bun ${MINIMUM_BUN_VERSION} or newer; found ${Bun.version}`);
  }
  const config = await loadProjectConfig(options.cwd);
  const distribution = options.command === "package" || options.command === "release";
  const signingIdentity = distribution ? config.release?.identity : config.signing?.identity;
  if (distribution && signingIdentity === undefined) {
    throw new Error(
      `release.identity is required for fia ${options.command}; ` +
        "configure a Developer ID Application identity in fia.config.ts",
    );
  }
  if (options.command === "release" && config.release?.notarization === undefined) {
    throw new Error(
      "release.notarization.keychainProfile is required for fia release; " +
        "create one with xcrun notarytool store-credentials",
    );
  }
  const stagingRoot = resolve(
    config.projectRoot,
    `.fia/${options.command}/${Date.now()}-${crypto.randomUUID()}`,
  );
  const appPath = resolve(stagingRoot, `${config.app.name}.app`);
  assertGeneratedPath(config.projectRoot, stagingRoot);
  assertGeneratedPath(config.projectRoot, appPath);
  const context: BuildContext = {
    command: options.command,
    config,
    stagingRoot,
    appPath,
    hostAssetDirectory: resolve(
      options.dependencies?.hostAssetDirectory ?? defaultHostAssetDirectory(),
    ),
    signingIdentity: signingIdentity ?? "-",
    distribution,
    debug: options.debug,
    io: options.io,
  };
  await mkdir(stagingRoot, { recursive: true });
  try {
    options.io.stdout(`Validating ${config.app.name}\n`);
    await verifySigningIdentity(context);
    await typecheck(context);
    const runner = await writeBackendRunner(context);
    await validateBackend(context, runner);
    if (options.command === "dev") {
      await assembleApp(context, await developmentBackend(context, runner));
      await launchHost(context, options.developmentAutomation);
      return;
    }
    await assembleApp(context, await buildProductionBackend(context, runner));
    if (options.command === "run") {
      await launchHost(context);
      return;
    }
    if (distribution) {
      const destination = await buildDistribution(context);
      options.io.stdout(
        `${options.command === "release" ? "Released" : "Packaged"} ${destination}\n`,
      );
      return;
    }
    const destination = await replaceDistribution(context);
    options.io.stdout(`Built ${destination}\n`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
