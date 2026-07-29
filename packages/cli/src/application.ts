import { constants, watch, type FSWatcher } from "node:fs";
import { createRequire } from "node:module";
import {
  access,
  chmod,
  cp,
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

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface HostManifest {
  schemaVersion: 2;
  cliVersion: string;
  hostVersion: string;
  sha256: string;
  architecture: "arm64";
  minimumSystemVersion: "14.0";
  configurationSchema: 5;
  mcpBridge: 1;
  mcpProtocol: "2026-07-28";
  nativeCapabilities: readonly ["tools", "resources", "subscriptions"];
}

interface BuildContext {
  config: ResolvedFIAConfig;
  stagingRoot: string;
  appPath: string;
  hostAssetDirectory: string;
  debug: boolean;
  io: ApplicationIO;
}

interface UIArtifact {
  directory: string;
  entry: string;
}

interface ServerArtifact {
  id: string;
  executable: string;
  args: readonly string[];
}

interface UIDevServer {
  process: Bun.Subprocess;
  url: string;
  output: Promise<void>;
}

const HOST_EXECUTABLE = "FIAHost";
const CSP_NONCE = "__FIA_CSP_NONCE__";
const MCP_PROTOCOL_VERSION = "2026-07-28";
const NATIVE_CAPABILITIES = ["tools", "resources", "subscriptions"] as const;
const MCP_CLIENT_IMPORT = import.meta.resolve("@modelcontextprotocol/client");
const MCP_CLIENT_STDIO_IMPORT = import.meta.resolve("@modelcontextprotocol/client/stdio");

function tagEnd(html: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index]!;
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return undefined;
}

export function injectCSPNonce(html: string, nonce = CSP_NONCE): string {
  const opening = /<(script|style)\b/gi;
  let cursor = 0;
  let result = "";
  while (cursor < html.length) {
    opening.lastIndex = cursor;
    const match = opening.exec(html);
    if (match === null) break;
    const end = tagEnd(html, match.index);
    if (end === undefined) break;
    result += html.slice(cursor, match.index);
    const originalTag = html.slice(match.index, end + 1);
    const cleanTag = originalTag.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    const suffixLength = cleanTag.endsWith("/>") ? 2 : 1;
    result += `${cleanTag.slice(0, -suffixLength)} nonce="${nonce}"${cleanTag.slice(-suffixLength)}`;
    const name = match[1]!.toLowerCase();
    const closing = new RegExp(`</${name}\\s*>`, "gi");
    closing.lastIndex = end + 1;
    const closingMatch = closing.exec(html);
    if (closingMatch === null) {
      cursor = end + 1;
      continue;
    }
    result += html.slice(end + 1, closingMatch.index + closingMatch[0].length);
    cursor = closingMatch.index + closingMatch[0].length;
  }
  return result + html.slice(cursor);
}

export function generatedMcpRunner(entry: string): string {
  return (
    `import factory from ${JSON.stringify(resolve(entry))};\n` +
    `import { isDefinedMcpServer, serveStdio } from "@semicoder/fia/mcp/server";\n` +
    `if (!isDefinedMcpServer(factory)) {\n` +
    `  process.stderr.write("MCP entry must default-export defineMcpServer(() => server).\\n");\n` +
    `  process.exit(65);\n` +
    `}\n` +
    `serveStdio(factory, { legacy: "reject", maxSubscriptions: 1024, onerror(error) {\n` +
    `  process.stderr.write(\`MCP server error: \${error.message}\\n\`);\n` +
    `} });\n`
  );
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

function assertGeneratedPath(projectRoot: string, path: string): void {
  const generatedRoot = resolve(projectRoot, ".fia");
  const fromRoot = relative(generatedRoot, resolve(path));
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`refusing to use a path outside .fia: ${path}`);
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

function defaultHostAssetDirectory(): string {
  return resolve(import.meta.dir, "../assets/host/darwin-arm64");
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
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
    manifest.schemaVersion !== 2 ||
    manifest.cliVersion !== CLI_VERSION ||
    manifest.hostVersion !== CLI_VERSION ||
    manifest.architecture !== "arm64" ||
    manifest.minimumSystemVersion !== "14.0" ||
    manifest.configurationSchema !== 5 ||
    manifest.mcpBridge !== 1 ||
    manifest.mcpProtocol !== MCP_PROTOCOL_VERSION ||
    manifest.nativeCapabilities.join(",") !== NATIVE_CAPABILITIES.join(",")
  ) {
    throw new Error("precompiled Host manifest is incompatible with this CLI");
  }
  await access(executable, constants.R_OK | constants.X_OK);
  if ((await sha256(executable)) !== manifest.sha256) {
    throw new Error("precompiled Host checksum does not match manifest");
  }
  await verifyArm64MachO("Host", executable, context);
  return executable;
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

async function writeMcpRunner(context: BuildContext): Promise<string | undefined> {
  const app = context.config.mcp?.app;
  if (app === undefined) return undefined;
  const runner = resolve(context.stagingRoot, "mcp-app-runner.ts");
  await Bun.write(runner, generatedMcpRunner(app.entry));
  return runner;
}

async function validateMcpFactory(context: BuildContext, runner: string): Promise<void> {
  const validator = resolve(context.stagingRoot, "validate-mcp-entry.ts");
  await Bun.write(
    validator,
    `
    import factory from ${JSON.stringify(pathToFileURL(context.config.mcp!.app!.entry).href)};
    import { isDefinedMcpServer } from "@semicoder/fia/mcp/server";
    if (!isDefinedMcpServer(factory)) {
      process.stderr.write("MCP entry must default-export defineMcpServer(() => server).\\n");
      process.exit(65);
    }
  `,
  );
  await checked(
    "MCP server factory validation",
    [process.execPath, validator],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await checked(
    "MCP runner validation",
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

async function buildProductionUI(context: BuildContext): Promise<UIArtifact> {
  const outputDirectory = resolve(context.stagingRoot, "ui");
  await mkdir(outputDirectory, { recursive: true });
  const projectRequire = createRequire(resolve(context.config.projectRoot, "package.json"));
  let pluginEntry: string;
  try {
    pluginEntry = projectRequire.resolve("bun-plugin-tailwind");
  } catch (error) {
    throw new Error("UI build requires bun-plugin-tailwind; run bun install first", {
      cause: error,
    });
  }
  const pluginModule = (await import(pathToFileURL(pluginEntry).href)) as {
    default?: Bun.BunPlugin;
  };
  if (pluginModule.default === undefined) {
    throw new Error("UI build could not load bun-plugin-tailwind");
  }
  const result = await Bun.build({
    entrypoints: [context.config.ui],
    naming: "[name].[ext]",
    outdir: outputDirectory,
    plugins: [pluginModule.default],
    root: context.config.projectRoot,
    target: "browser",
  });
  if (!result.success) {
    const detail =
      result.logs
        .map((log) => log.message)
        .join("\n")
        .trim() || "Tailwind CSS compilation failed";
    throw new Error(`UI build failed: ${detail}`);
  }
  const output = resolve(outputDirectory, basename(context.config.ui));
  let html = injectCSPNonce(await readFile(output, "utf8"));
  if (!html.includes(CSP_NONCE))
    throw new Error("UI build contains no script or style tags to protect with CSP");
  await Bun.write(output, html);
  return { directory: outputDirectory, entry: output };
}

async function buildProductionServers(
  context: BuildContext,
  runner: string | undefined,
): Promise<ServerArtifact[]> {
  const artifacts: ServerArtifact[] = [];
  if (runner !== undefined) {
    const executable = resolve(context.stagingRoot, "servers/app");
    await mkdir(resolve(executable, ".."), { recursive: true });
    await checked(
      "Application MCP server build",
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
    artifacts.push({ id: "app", executable, args: [] });
  }
  for (const [id, server] of Object.entries(context.config.mcp?.servers ?? {})) {
    artifacts.push({ id, executable: server.executable, args: server.args });
  }
  for (const artifact of artifacts) {
    await verifyArm64MachO(`MCP server ${artifact.id}`, artifact.executable, context);
    await smokeMcpServer(context, artifact);
  }
  return artifacts;
}

async function smokeMcpServer(context: BuildContext, server: ServerArtifact): Promise<void> {
  const script = resolve(context.stagingRoot, "smoke-mcp.ts");
  if (!(await existingFile(script))) {
    await Bun.write(
      script,
      `
      import { Client } from ${JSON.stringify(MCP_CLIENT_IMPORT)};
      import { StdioClientTransport } from ${JSON.stringify(MCP_CLIENT_STDIO_IMPORT)};
      const [command, cwd, argsJSON] = process.argv.slice(2);
      const transport = new StdioClientTransport({
        command,
        cwd,
        args: JSON.parse(argsJSON),
        stderr: "inherit",
        maxBufferSize: 1024 * 1024,
      });
      const client = new Client(
        { name: "fia-build-smoke", version: ${JSON.stringify(CLI_VERSION)} },
        { versionNegotiation: { mode: { pin: ${JSON.stringify(MCP_PROTOCOL_VERSION)} }, probe: { timeoutMs: 10000 } } },
      );
      try {
        await client.connect(transport, { timeout: 10000 });
        await client.listTools(undefined, { timeout: 10000 });
      } finally {
        await client.close();
      }
    `,
    );
  }
  const cwd = resolve(context.stagingRoot, `smoke/${server.id}`);
  await mkdir(cwd, { recursive: true });
  await checked(
    `MCP server ${server.id} modern discover smoke test`,
    [process.execPath, script, server.executable, cwd, JSON.stringify(server.args)],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
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
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
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
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
`;
}

function hostConfiguration(
  config: ResolvedFIAConfig,
  ui: { mode: "bundled"; entry: string } | { mode: "development"; url: string },
  servers: ReadonlyArray<ServerArtifact & { manifestExecutable: string; sha256: string }>,
): Record<string, unknown> {
  return {
    schemaVersion: 5,
    bridgeVersion: 1,
    mcpProtocolVersion: MCP_PROTOCOL_VERSION,
    app: {
      name: config.app.name,
      identifier: config.app.identifier,
      mode: config.app.mode,
    },
    window: config.window,
    statusBar: config.statusBar,
    ui:
      ui.mode === "bundled"
        ? { mode: "bundled", entry: ui.entry, url: null }
        : { mode: "development", entry: null, url: ui.url },
    mcpServers: servers.map((server) => ({
      id: server.id,
      executable: server.manifestExecutable,
      arguments: [...server.args],
      sha256: server.sha256,
    })),
    nativeCapabilities: NATIVE_CAPABILITIES,
  };
}

async function assembleApp(
  context: BuildContext,
  options: {
    ui: { mode: "bundled"; artifact: UIArtifact } | { mode: "development"; url: string };
    servers: readonly ServerArtifact[];
    production: boolean;
  },
): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const macOS = resolve(contents, "MacOS");
  const resources = resolve(contents, "Resources");
  const helpers = resolve(contents, "Helpers/MCPServers");
  await Promise.all([
    mkdir(macOS, { recursive: true }),
    mkdir(resources, { recursive: true }),
    mkdir(helpers, { recursive: true }),
  ]);

  const hostSource = await verifyHostAsset(context);
  const hostDestination = resolve(macOS, HOST_EXECUTABLE);
  await copyFile(hostSource, hostDestination);
  await chmod(hostDestination, 0o755);

  if (options.ui.mode === "bundled") {
    await cp(options.ui.artifact.directory, resolve(resources, "UI"), { recursive: true });
  }
  if (context.config.app.icon !== undefined) {
    await copyFile(context.config.app.icon, resolve(resources, "AppIcon.icns"));
  }

  const stagedServers: Array<ServerArtifact & { manifestExecutable: string }> = [];
  for (const server of options.servers) {
    if (options.production) {
      const destination = resolve(helpers, server.id);
      await copyFile(server.executable, destination);
      await chmod(destination, 0o755);
      stagedServers.push({
        ...server,
        executable: destination,
        manifestExecutable: `Helpers/MCPServers/${server.id}`,
      });
    } else {
      stagedServers.push({
        ...server,
        manifestExecutable: server.executable,
      });
    }
  }

  if (options.production) {
    for (const server of stagedServers) {
      await checked(
        `MCP server ${server.id} signing`,
        ["/usr/bin/codesign", "--force", "--sign", "-", server.executable],
        context.config.projectRoot,
        context.debug,
        context.io,
      );
      await checked(
        `MCP server ${server.id} signature verification`,
        ["/usr/bin/codesign", "--verify", "--strict", server.executable],
        context.config.projectRoot,
        context.debug,
        context.io,
      );
    }
  }
  // Code signing mutates Mach-O files, so the runtime integrity hash must be
  // computed from the final signed bytes.
  const manifestServers = await Promise.all(
    stagedServers.map(async (server) => ({
      ...server,
      sha256: await sha256(server.executable),
    })),
  );

  const uiConfiguration =
    options.ui.mode === "bundled"
      ? { mode: "bundled" as const, entry: `UI/${basename(options.ui.artifact.entry)}` }
      : { mode: "development" as const, url: options.ui.url };
  await Promise.all([
    Bun.write(resolve(contents, "Info.plist"), infoPlist(context.config)),
    Bun.write(resolve(contents, "PkgInfo"), "APPL????"),
    Bun.write(
      resolve(resources, "fia-config.json"),
      `${JSON.stringify(hostConfiguration(context.config, uiConfiguration, manifestServers), null, 2)}\n`,
    ),
  ]);

  await checked(
    "Host signing",
    ["/usr/bin/codesign", "--force", "--sign", "-", hostDestination],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await checked(
    "application signing",
    ["/usr/bin/codesign", "--force", "--sign", "-", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  await verifyApp(context, options.production);
}

async function verifyApp(context: BuildContext, production: boolean): Promise<void> {
  const contents = resolve(context.appPath, "Contents");
  const required = [
    resolve(contents, "Info.plist"),
    resolve(contents, "MacOS/FIAHost"),
    resolve(contents, "Resources/fia-config.json"),
  ];
  for (const path of required) await access(path, constants.R_OK);
  const configuration = JSON.parse(
    await readFile(resolve(contents, "Resources/fia-config.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    configuration.schemaVersion !== 5 ||
    configuration.bridgeVersion !== 1 ||
    configuration.mcpProtocolVersion !== MCP_PROTOCOL_VERSION
  ) {
    throw new Error("packaged Host configuration is incompatible");
  }
  if (!Array.isArray(configuration.mcpServers)) {
    throw new Error("packaged Host configuration has no MCP server manifest");
  }
  if (production) {
    for (const value of configuration.mcpServers) {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { id?: unknown }).id !== "string" ||
        typeof (value as { executable?: unknown }).executable !== "string" ||
        typeof (value as { sha256?: unknown }).sha256 !== "string"
      ) {
        throw new Error("packaged MCP server manifest is invalid");
      }
      const server = value as { id: string; executable: string; sha256: string };
      if (server.executable !== `Helpers/MCPServers/${server.id}`) {
        throw new Error(`packaged MCP server ${server.id} is outside the fixed helper layout`);
      }
      const executable = resolve(contents, server.executable);
      await access(executable, constants.R_OK | constants.X_OK);
      if ((await sha256(executable)) !== server.sha256) {
        throw new Error(`packaged MCP server ${server.id} checksum does not match`);
      }
      await checked(
        `packaged MCP server ${server.id} signature verification`,
        ["/usr/bin/codesign", "--verify", "--strict", executable],
        context.config.projectRoot,
        context.debug,
        context.io,
      );
    }
  }
  for (const removed of ["fia-runtime", "fia-backend"]) {
    if (await pathExists(resolve(contents, "MacOS", removed))) {
      throw new Error(`removed executable unexpectedly packaged: ${removed}`);
    }
  }
  await checked(
    "application signature verification",
    ["/usr/bin/codesign", "--verify", "--strict", "--deep", context.appPath],
    context.config.projectRoot,
    context.debug,
    context.io,
  );
  if (production) {
    await access(resolve(contents, "Resources/UI", basename(context.config.ui)), constants.R_OK);
  }
}

async function productionApp(context: BuildContext, runner: string | undefined): Promise<void> {
  const [ui, servers] = await Promise.all([
    buildProductionUI(context),
    buildProductionServers(context, runner),
  ]);
  await assembleApp(context, {
    ui: { mode: "bundled", artifact: ui },
    servers,
    production: true,
  });
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

async function startUIDevServer(context: BuildContext): Promise<UIDevServer> {
  const entry = resolve(context.stagingRoot, "ui-dev-server.ts");
  await Bun.write(
    entry,
    `
    import page from ${JSON.stringify(context.config.ui)};
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      routes: { "/": page },
      development: { hmr: true, console: true },
    });
    console.log(JSON.stringify({ type: "ready", port: server.port }));
  `,
  );
  const child = Bun.spawn([process.execPath, "--hot", "--no-clear-screen", entry], {
    cwd: context.config.projectRoot,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 10_000;
  let port: number | undefined;
  while (port === undefined && Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("UI development server readiness timed out")), remaining),
    );
    const result = await Promise.race([reader.read(), timeout]);
    if (result.done) throw new Error("UI development server exited before becoming ready");
    buffer += decoder.decode(result.value, { stream: true });
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const value = JSON.parse(line) as { type?: unknown; port?: unknown };
        if (value.type === "ready" && typeof value.port === "number") {
          port = value.port;
          break;
        }
      } catch {
        context.io.stdout(line + "\n");
      }
    }
  }
  if (port === undefined) throw new Error("UI development server did not report a port");
  const output = (async () => {
    if (buffer.length > 0) context.io.stdout(buffer);
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        context.io.stdout(decoder.decode(result.value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
  })();
  void streamToIO(child.stderr, context.io.stderr);
  return { process: child, url: `http://127.0.0.1:${port}/`, output };
}

function watchMcpServers(
  context: BuildContext,
  host: Bun.Subprocess,
  runner: string | undefined,
): () => void {
  const hostInput = host.stdin;
  if (hostInput === undefined || typeof hostInput === "number") {
    throw new Error("Host development control channel is unavailable");
  }
  const watchers: FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;
  const restart = (serverID: string, validate: boolean): void => {
    const old = timers.get(serverID);
    if (old !== undefined) clearTimeout(old);
    timers.set(
      serverID,
      setTimeout(async () => {
        if (closed || host.exitCode !== null) return;
        if (validate && runner !== undefined) {
          try {
            await checked(
              "Application MCP development validation",
              [
                process.execPath,
                "build",
                "--target=bun",
                runner,
                "--outdir",
                resolve(context.stagingRoot, "dev-check"),
              ],
              context.config.projectRoot,
              context.debug,
              context.io,
            );
          } catch (error) {
            context.io.stderr(
              `MCP source change was not activated: ${error instanceof Error ? error.message : error}\n`,
            );
            return;
          }
        }
        hostInput.write(`${JSON.stringify({ type: "restartMcpServer", serverId: serverID })}\n`);
        hostInput.flush();
        context.io.stdout(`Restarted MCP server ${serverID}\n`);
      }, 180),
    );
  };
  for (const path of context.config.mcp?.app?.watch ?? []) {
    const watcher = watch(path, { recursive: true }, () => restart("app", true));
    watcher.on("error", (error) => context.io.stderr(`MCP watcher failed: ${error.message}\n`));
    watchers.push(watcher);
  }
  for (const [id, server] of Object.entries(context.config.mcp?.servers ?? {})) {
    const executableName = basename(server.executable);
    const watcher = watch(dirname(server.executable), (_, changed) => {
      if (changed === null || changed.toString() === executableName) restart(id, false);
    });
    watcher.on("error", (error) => context.io.stderr(`MCP watcher failed: ${error.message}\n`));
    watchers.push(watcher);
  }
  return () => {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

async function launchHost(
  context: BuildContext,
  options: { uiServer?: UIDevServer; runner?: string } = {},
): Promise<void> {
  const executable = resolve(context.appPath, "Contents/MacOS", HOST_EXECUTABLE);
  context.io.stdout(`Launching ${context.config.app.name}\n`);
  const child = Bun.spawn([executable], {
    cwd: context.config.projectRoot,
    env: { ...process.env, FIA_INTERNAL_DIAGNOSTICS: "1" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stopWatching = watchMcpServers(context, child, options.runner);
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
    stopWatching();
    child.stdin.end();
    if (options.uiServer !== undefined && options.uiServer.process.exitCode === null) {
      options.uiServer.process.kill("SIGTERM");
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

async function developmentApp(context: BuildContext, runner: string | undefined): Promise<void> {
  const uiServer = await startUIDevServer(context);
  try {
    const servers: ServerArtifact[] = [];
    if (runner !== undefined) {
      servers.push({ id: "app", executable: process.execPath, args: [runner] });
    }
    for (const [id, server] of Object.entries(context.config.mcp?.servers ?? {})) {
      await verifyArm64MachO(`MCP server ${id}`, server.executable, context);
      servers.push({ id, executable: server.executable, args: server.args });
    }
    await assembleApp(context, {
      ui: { mode: "development", url: uiServer.url },
      servers,
      production: false,
    });
    await launchHost(context, { uiServer, runner });
  } finally {
    if (uiServer.process.exitCode === null) uiServer.process.kill("SIGKILL");
    await uiServer.process.exited;
    await uiServer.output;
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
    const runner = await writeMcpRunner(context);
    if (runner !== undefined) await validateMcpFactory(context, runner);
    if (options.command === "dev") {
      await developmentApp(context, runner);
      return;
    }
    await productionApp(context, runner);
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
