import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { checkProject } from "./check.ts";
import type { CLIIO } from "./cli.ts";
import {
  FIA_BACKEND_PROTOCOL_VERSION,
  FIA_NATIVE_PROTOCOL_VERSION,
  CLI_VERSION,
} from "./metadata.ts";
import { loadProjectConfig, type ResolvedFIAConfig, type UpdateChannel } from "./project-config.ts";

export type ApplicationCommand = "dev" | "run" | "test" | "build" | "release";
export type BrowserCompanion = "chrome" | "edge";

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export type ApplicationProcessRunner = (
  command: readonly string[],
  options: { cwd: string; env?: Readonly<Record<string, string>>; inherit?: boolean },
) => Promise<ProcessResult>;

export interface ApplicationCommandDependencies {
  runner?: ApplicationProcessRunner;
  launch?: (executable: string, environment: Readonly<Record<string, string>>) => Promise<number>;
}

export interface ApplicationCommandOptions {
  readonly command: ApplicationCommand;
  readonly cwd: string;
  readonly debug: boolean;
  readonly io: CLIIO;
  readonly browser?: BrowserCompanion;
  readonly app?: boolean;
  readonly channel?: UpdateChannel;
  readonly dependencies?: ApplicationCommandDependencies;
}

interface BuildResult {
  readonly app: string;
  readonly executable: string;
  readonly configuration: "debug" | "release";
}

interface RuntimeManifest {
  readonly schema: 1;
  readonly frameworkVersion: string;
  readonly nativeProtocolVersion: number;
  readonly app: Omit<ResolvedFIAConfig["app"], "icon">;
  readonly web: { enabled: boolean; directory?: string };
  readonly backend: {
    enabled: boolean;
    protocolVersion: number;
    executable?: string;
    sha256?: string;
    mount: string;
  };
  readonly statusItem?: ResolvedFIAConfig["statusItem"];
  readonly permissions: ResolvedFIAConfig["native"]["permissions"];
  readonly updater?: ResolvedFIAConfig["updater"];
}

const APP_EXECUTABLE = "FIAAppExecutable";

async function defaultRunner(
  command: readonly string[],
  options: { cwd: string; env?: Readonly<Record<string, string>>; inherit?: boolean },
): Promise<ProcessResult> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.inherit === false ? "ignore" : "inherit",
    stdout: options.inherit === false ? "pipe" : "inherit",
    stderr: options.inherit === false ? "pipe" : "inherit",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.inherit === false ? new Response(child.stdout).text() : Promise.resolve(undefined),
    options.inherit === false ? new Response(child.stderr).text() : Promise.resolve(undefined),
  ]);
  return {
    exitCode,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

async function runChecked(
  runner: ApplicationProcessRunner,
  command: readonly string[],
  cwd: string,
  label: string,
  options: { env?: Readonly<Record<string, string>>; inherit?: boolean } = {},
): Promise<ProcessResult> {
  const result = await runner(command, { cwd, ...options });
  if (result.exitCode !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      `${label} failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sparkleSignature(appcast: string, archiveName: string): string | undefined {
  for (const enclosure of appcast.match(/<enclosure\b[^>]*>/gu) ?? []) {
    const location = /\burl="([^"]+)"/u.exec(enclosure)?.[1];
    const signature = /\bsparkle:edSignature="([A-Za-z0-9+/=]+)"/u.exec(enclosure)?.[1];
    if (location === undefined || signature === undefined) continue;
    try {
      if (decodeURIComponent(new URL(location).pathname.split("/").at(-1) ?? "") === archiveName) {
        return signature;
      }
    } catch {
      // Ignore malformed or non-absolute enclosure URLs.
    }
  }
  return undefined;
}

function infoPlist(config: ResolvedFIAConfig): string {
  const updater = config.updater;
  const feed = updater?.feeds[updater.channel];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>${xml(config.app.name)}</string>
  <key>CFBundleExecutable</key><string>${APP_EXECUTABLE}</string>
  <key>CFBundleIdentifier</key><string>${xml(config.app.identifier)}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>${xml(config.app.name)}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xml(config.app.version)}</string>
  <key>CFBundleVersion</key><string>${config.app.build}</string>
  <key>LSMinimumSystemVersion</key><string>${xml(config.app.minimumMacOS)}</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  ${config.app.activationPolicy === "accessory" ? "<key>LSUIElement</key><true/>" : ""}
  ${config.app.icon === undefined ? "" : "<key>CFBundleIconFile</key><string>AppIcon</string>"}
  ${updater === undefined ? "" : `<key>SUPublicEDKey</key><string>${xml(updater.publicKey)}</string>`}
  ${feed === undefined ? "" : `<key>SUFeedURL</key><string>${xml(feed)}</string>`}
  ${updater?.ui === "custom" ? "<key>SUEnableAutomaticChecks</key><false/>" : ""}
</dict></plist>
`;
}

async function findFile(
  root: string,
  predicate: (path: string) => boolean,
): Promise<string | undefined> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(root, entry.name);
      if (predicate(path)) return path;
      if (entry.isDirectory()) {
        const nested = await findFile(path, predicate);
        if (nested !== undefined) return nested;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function copySparkleFramework(projectRoot: string, frameworks: string): Promise<string> {
  const buildRoot = resolve(projectRoot, ".fia/swift-build");
  const source = await findFile(buildRoot, (path) => basename(path) === "Sparkle.framework");
  if (source === undefined) {
    throw new Error(
      "Sparkle.framework was not produced by SwiftPM; resolve the native package before building",
    );
  }
  const destination = resolve(frameworks, "Sparkle.framework");
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
  return destination;
}

async function sign(
  runner: ApplicationProcessRunner,
  path: string,
  identity: string,
  cwd: string,
  hardened: boolean,
): Promise<void> {
  await runChecked(
    runner,
    [
      "/usr/bin/codesign",
      "--force",
      "--sign",
      identity,
      "--timestamp",
      ...(hardened ? ["--options", "runtime"] : []),
      path,
    ],
    cwd,
    `signing ${basename(path)}`,
  );
}

async function signSparkle(
  runner: ApplicationProcessRunner,
  framework: string,
  identity: string,
  cwd: string,
  hardened: boolean,
): Promise<void> {
  const nested = await Promise.all([
    findFile(framework, (path) => basename(path) === "Downloader.xpc"),
    findFile(framework, (path) => basename(path) === "Installer.xpc"),
    findFile(framework, (path) => basename(path) === "Updater.app"),
    findFile(framework, (path) => basename(path) === "Autoupdate"),
  ]);
  if (nested.some((path) => path === undefined))
    throw new Error("Sparkle.framework is missing required helpers");
  for (const path of nested) await sign(runner, path!, identity, cwd, hardened);
  await sign(runner, framework, identity, cwd, hardened);
}

async function assembleApplication(
  config: ResolvedFIAConfig,
  runner: ApplicationProcessRunner,
  configuration: "debug" | "release",
  destination: string,
  options: { buildWeb: boolean },
): Promise<BuildResult> {
  const root = config.projectRoot;
  const scratch = resolve(root, ".fia/swift-build");
  const app = resolve(destination, `${config.app.name}.app`);
  const contents = resolve(app, "Contents");
  const macOS = resolve(contents, "MacOS");
  const helpers = resolve(contents, "Helpers");
  const resources = resolve(contents, "Resources");
  const frameworks = resolve(contents, "Frameworks");
  await rm(app, { recursive: true, force: true });
  await mkdir(macOS, { recursive: true });
  await mkdir(resources, { recursive: true });

  if (config.web.enabled && options.buildWeb) {
    await runChecked(runner, [process.execPath, "x", "vite", "build"], root, "Web build");
  }
  if (config.backend.enabled) {
    const backendOutput = resolve(root, ".fia/build/FIABunBackend");
    const backendRunner = resolve(root, ".fia/build/backend-runner.ts");
    await mkdir(dirname(backendOutput), { recursive: true });
    await writeFile(
      backendRunner,
      `import definition from ${JSON.stringify(config.backend.entry!)};\nimport { runBackend } from "@semicoder/fia/backend";\nawait runBackend(definition);\n`,
    );
    if (configuration === "debug") {
      await writeFile(
        backendOutput,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} --hot ${shellQuote(backendRunner)}\n`,
      );
      await chmod(backendOutput, 0o755);
    } else {
      await runChecked(
        runner,
        [
          process.execPath,
          "build",
          backendRunner,
          "--compile",
          "--target=bun-darwin-arm64",
          `--outfile=${backendOutput}`,
        ],
        root,
        "Bun Backend build",
      );
    }
  }

  await runChecked(
    runner,
    [
      "/usr/bin/xcrun",
      "swift",
      "build",
      "--package-path",
      resolve(root, "native"),
      "--scratch-path",
      scratch,
      ...(config.updater === undefined
        ? []
        : ["--manifest-cache", "none", "--disable-build-manifest-caching"]),
      "--product",
      APP_EXECUTABLE,
      "--configuration",
      configuration,
      "--arch",
      "arm64",
    ],
    root,
    "Swift application build",
    {
      env: config.updater === undefined ? undefined : { FIA_BUILD_SPARKLE: "1" },
    },
  );
  const sourceExecutable = resolve(scratch, "arm64-apple-macosx", configuration, APP_EXECUTABLE);
  await access(sourceExecutable);
  const executable = resolve(macOS, APP_EXECUTABLE);
  await copyFile(sourceExecutable, executable);
  await chmod(executable, 0o755);
  if (config.updater !== undefined) {
    await runChecked(
      runner,
      ["/usr/bin/install_name_tool", "-add_rpath", "@executable_path/../Frameworks", executable],
      root,
      "Sparkle runtime search path",
    );
  }

  if (config.web.enabled && options.buildWeb) {
    await cp(config.web.dist, resolve(resources, "web"), { recursive: true });
  }
  if (config.backend.enabled) {
    await mkdir(helpers, { recursive: true });
    const backend = resolve(helpers, "FIABackend");
    await copyFile(resolve(root, ".fia/build/FIABunBackend"), backend);
    await chmod(backend, 0o755);
  }
  if (config.app.icon !== undefined)
    await copyFile(config.app.icon, resolve(resources, "AppIcon.icns"));

  let sparkle: string | undefined;
  if (config.updater !== undefined) {
    await mkdir(frameworks, { recursive: true });
    sparkle = await copySparkleFramework(root, frameworks);
  }
  const identity =
    configuration === "release"
      ? (config.signing?.releaseIdentity ?? "-")
      : (config.signing?.developmentIdentity ?? "-");
  const hardened = configuration === "release" && identity !== "-";
  if (config.backend.enabled)
    await sign(runner, resolve(helpers, "FIABackend"), identity, root, hardened);
  // Signing mutates the executable; runtime integrity must describe the signed bytes.
  const backendSHA256 = config.backend.enabled
    ? createHash("sha256")
        .update(await readFile(resolve(helpers, "FIABackend")))
        .digest("hex")
    : undefined;
  const manifest: RuntimeManifest = {
    schema: 1,
    frameworkVersion: CLI_VERSION,
    nativeProtocolVersion: FIA_NATIVE_PROTOCOL_VERSION,
    app: {
      name: config.app.name,
      identifier: config.app.identifier,
      version: config.app.version,
      build: config.app.build,
      minimumMacOS: config.app.minimumMacOS,
      activationPolicy: config.app.activationPolicy,
    },
    web: { enabled: config.web.enabled, ...(config.web.enabled ? { directory: "web" } : {}) },
    backend: {
      enabled: config.backend.enabled,
      protocolVersion: FIA_BACKEND_PROTOCOL_VERSION,
      ...(config.backend.enabled ? { executable: "Helpers/FIABackend" } : {}),
      ...(backendSHA256 === undefined ? {} : { sha256: backendSHA256 }),
      mount: config.backend.mount,
    },
    ...(config.statusItem === undefined ? {} : { statusItem: config.statusItem }),
    permissions: config.native.permissions,
    ...(config.updater === undefined ? {} : { updater: config.updater }),
  };
  await writeFile(resolve(resources, "fia.runtime.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(contents, "Info.plist"), infoPlist(config));

  if (sparkle !== undefined) await signSparkle(runner, sparkle, identity, root, hardened);
  await sign(runner, app, identity, root, hardened);
  await runChecked(
    runner,
    ["/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", app],
    root,
    "code signature verification",
  );
  return { app, executable, configuration };
}

async function build(
  config: ResolvedFIAConfig,
  runner: ApplicationProcessRunner,
  configuration: "debug" | "release",
  options: { buildWeb?: boolean } = {},
): Promise<BuildResult> {
  const destination =
    configuration === "debug"
      ? resolve(config.projectRoot, ".fia/dev")
      : resolve(config.projectRoot, "dist");
  await mkdir(destination, { recursive: true });
  return await assembleApplication(config, runner, configuration, destination, {
    buildWeb: options.buildWeb ?? true,
  });
}

async function reservePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          const port = socket.localPort;
          server.stop(true);
          resolvePort(port);
        },
        data() {},
        error(_socket, error) {
          reject(error);
        },
      },
    });
    void Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data() {},
        error(_socket, error) {
          reject(error);
        },
      },
    });
  });
}

async function waitForEndpoint(
  path: string,
): Promise<{ origin: string; bootstrapURL: string; session: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as {
        origin: string;
        bootstrapURL: string;
        session: string;
      };
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("the native gateway did not publish its endpoint within 15 seconds");
}

async function waitForDevelopmentServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {
      // Vite may still be binding the reserved port.
    }
    await Bun.sleep(50);
  }
  throw new Error(`Vite did not become ready within 15 seconds: ${url}`);
}

async function launchExecutable(
  executable: string,
  environment: Readonly<Record<string, string>>,
): Promise<number> {
  const child = Bun.spawn([executable], {
    cwd: dirname(dirname(dirname(executable))),
    env: { ...process.env, ...environment },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

async function openBrowser(
  runner: ApplicationProcessRunner,
  browser: BrowserCompanion,
  url: string,
  cwd: string,
): Promise<void> {
  const name = browser === "chrome" ? "Google Chrome" : "Microsoft Edge";
  await runChecked(runner, ["/usr/bin/open", "-a", name, url], cwd, `${name} launch`);
}

async function runDevelopment(
  config: ResolvedFIAConfig,
  runner: ApplicationProcessRunner,
  options: ApplicationCommandOptions,
): Promise<void> {
  if (options.browser !== undefined && !config.web.enabled) {
    throw new Error("Browser Companion requires [web].enabled = true");
  }
  const endpointFile = resolve(config.projectRoot, ".fia/dev/gateway.json");
  const readyFile = resolve(config.projectRoot, ".fia/dev/vite.ready");
  await rm(endpointFile, { force: true });
  await rm(readyFile, { force: true });
  let vite: ReturnType<typeof Bun.spawn> | undefined;
  let developmentURL: string | undefined;
  let port: number | undefined;
  if (config.web.enabled) {
    port = await reservePort();
    developmentURL = `http://127.0.0.1:${port}`;
  }
  const output = await build(config, runner, "debug", { buildWeb: false });
  const shouldShowApp = options.app ?? options.browser === undefined;
  const usesGateway = config.web.enabled || config.backend.enabled || options.browser !== undefined;
  const environment = {
    FIA_DEVELOPMENT: "1",
    ...(shouldShowApp ? {} : { FIA_HEADLESS: "1" }),
    ...(usesGateway ? { FIA_ENDPOINT_FILE: endpointFile } : {}),
    ...(developmentURL === undefined ? {} : { FIA_WEB_DEV_URL: developmentURL }),
    ...(developmentURL === undefined ? {} : { FIA_DEV_READY_FILE: readyFile }),
  };
  const launch = options.dependencies?.launch ?? launchExecutable;
  const appExit = launch(output.executable, environment);
  try {
    const endpoint = usesGateway ? await waitForEndpoint(endpointFile) : undefined;
    if (config.web.enabled && port !== undefined) {
      vite = Bun.spawn(
        [
          process.execPath,
          "x",
          "vite",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
        ],
        {
          cwd: config.projectRoot,
          env: {
            ...process.env,
            FIA_NATIVE_ORIGIN: endpoint!.origin,
            FIA_NATIVE_SESSION: endpoint!.session,
            FIA_BACKEND_MOUNT: config.backend.mount,
          },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      await waitForDevelopmentServer(developmentURL!);
      await writeFile(readyFile, "ready\n");
    }
    if (options.browser !== undefined) {
      await openBrowser(runner, options.browser, endpoint!.bootstrapURL, config.projectRoot);
    }
    const code = await appExit;
    if (code !== 0) throw new Error(`application exited with status ${code}`);
  } finally {
    vite?.kill("SIGTERM");
  }
}

async function createRelease(
  config: ResolvedFIAConfig,
  runner: ApplicationProcessRunner,
  channel: UpdateChannel,
): Promise<void> {
  if (config.signing?.releaseIdentity === undefined) {
    throw new Error("release requires signing.releaseIdentity (Developer ID Application)");
  }
  if (config.signing.notarizationProfile === undefined) {
    throw new Error("release requires signing.notarizationProfile");
  }
  if (config.updater === undefined)
    throw new Error("release requires a complete [updater] configuration");
  if (config.updater.feeds[channel] === undefined) {
    throw new Error(`release channel ${channel} requires updater.feeds.${channel}`);
  }
  const releaseConfig: ResolvedFIAConfig = {
    ...config,
    updater: { ...config.updater, channel },
  };
  const output = await build(releaseConfig, runner, "release");
  const releaseDirectory = resolve(config.projectRoot, `dist/updates/${channel}`);
  await mkdir(releaseDirectory, { recursive: true });
  const fileName = `${config.app.name}-${config.app.version}-${config.app.build}-mac-arm64.zip`;
  const zip = resolve(releaseDirectory, fileName);
  await rm(zip, { force: true });
  await runChecked(
    runner,
    ["/usr/bin/ditto", "-c", "-k", "--keepParent", output.app, zip],
    config.projectRoot,
    "archive creation",
  );
  await runChecked(
    runner,
    [
      "/usr/bin/xcrun",
      "notarytool",
      "submit",
      zip,
      "--keychain-profile",
      config.signing.notarizationProfile,
      "--wait",
    ],
    config.projectRoot,
    "notarization",
  );
  await runChecked(
    runner,
    ["/usr/bin/xcrun", "stapler", "staple", output.app],
    config.projectRoot,
    "stapling",
  );
  await runChecked(
    runner,
    ["/usr/bin/spctl", "--assess", "--type", "execute", "--verbose=4", output.app],
    config.projectRoot,
    "Gatekeeper verification",
  );
  await rm(zip, { force: true });
  await runChecked(
    runner,
    ["/usr/bin/ditto", "-c", "-k", "--keepParent", output.app, zip],
    config.projectRoot,
    "stapled archive creation",
  );

  const sha256 = createHash("sha256")
    .update(await readFile(zip))
    .digest("hex");
  await writeFile(`${zip}.sha256`, `${sha256}  ${basename(zip)}\n`);
  const sparkleTool = await findFile(
    resolve(config.projectRoot, ".fia/swift-build/artifacts"),
    (path) => basename(path) === "generate_appcast",
  );
  if (sparkleTool === undefined)
    throw new Error("Sparkle generate_appcast tool was not found in SwiftPM artifacts");
  await runChecked(
    runner,
    [sparkleTool, releaseDirectory],
    config.projectRoot,
    "Sparkle appcast generation",
  );
  const appcast = resolve(releaseDirectory, "appcast.xml");
  const appcastContents = await readFile(appcast, "utf8");
  const edSignature = sparkleSignature(appcastContents, fileName);
  const signatureBytes = edSignature === undefined ? undefined : Buffer.from(edSignature, "base64");
  if (
    edSignature === undefined ||
    signatureBytes?.byteLength !== 64 ||
    signatureBytes.toString("base64") !== edSignature
  ) {
    throw new Error("generated appcast does not contain a Sparkle EdDSA signature");
  }
  const signature = `${zip}.ed25519`;
  await writeFile(signature, `${edSignature}\n`);
  const report = {
    schemaVersion: 1,
    frameworkVersion: CLI_VERSION,
    channel,
    application: output.app,
    archive: zip,
    appcast,
    sha256,
    ed25519Signature: signature,
    signed: true,
    notarized: true,
    stapled: true,
  };
  await writeFile(
    resolve(releaseDirectory, "release-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

export async function executeApplicationCommand(options: ApplicationCommandOptions): Promise<void> {
  const runner = options.dependencies?.runner ?? defaultRunner;
  const config = await loadProjectConfig(options.cwd);
  const report = await checkProject(config.projectRoot);
  if (!report.ok) {
    throw new Error(
      report.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
        .join("; "),
    );
  }

  switch (options.command) {
    case "test":
      if (config.web.enabled) {
        await runChecked(
          runner,
          [process.execPath, "x", "tsc", "--noEmit"],
          config.projectRoot,
          "Web typecheck",
        );
      }
      await runChecked(
        runner,
        [
          "/usr/bin/xcrun",
          "swift",
          "test",
          "--package-path",
          resolve(config.projectRoot, "native"),
        ],
        config.projectRoot,
        "Swift tests",
      );
      return;
    case "build": {
      const output = await build(config, runner, "release");
      options.io.stdout(`${output.app}\n`);
      return;
    }
    case "run": {
      const output = await build(config, runner, "release");
      const code = await (options.dependencies?.launch ?? launchExecutable)(output.executable, {});
      if (code !== 0) throw new Error(`application exited with status ${code}`);
      return;
    }
    case "dev":
      await runDevelopment(config, runner, options);
      return;
    case "release":
      await createRelease(config, runner, options.channel ?? config.updater?.channel ?? "stable");
  }
}

export function applicationRelativePath(config: ResolvedFIAConfig, path: string): string {
  return relative(config.projectRoot, path);
}
