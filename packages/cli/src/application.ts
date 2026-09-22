import { watch } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  assetDirectory,
  releaseFiles,
  runtimeId,
  sha256,
  verifyAssets,
  type CodeRelease,
} from "./artifacts.ts";
import { CLI_VERSION } from "./metadata.ts";
import { loadProjectConfig, type ResolvedFIAConfig } from "./project-config.ts";
import { createSession } from "./session.ts";
import { readInspection, waitUntil, smokeApplication } from "./smoke.ts";
import { writeSignedRelease } from "./updates.ts";

export interface RunSettings {
  cwd: string;
  env?: Record<string, string | undefined>;
}
export type ApplicationProcessRunner = (
  command: readonly string[],
  settings: RunSettings,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
export const defaultRunner: ApplicationProcessRunner = async (command, settings) => {
  const child = Bun.spawn([...command], {
    cwd: settings.cwd,
    env: { ...process.env, ...settings.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};
async function checked(runner: ApplicationProcessRunner, command: readonly string[], cwd: string) {
  const result = await runner(command, { cwd });
  if (result.exitCode !== 0)
    throw new Error(command[0] + " failed: " + (result.stderr || result.stdout));
  return result;
}
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function infoPlist(config: ResolvedFIAConfig) {
  const values: Record<string, string> = {
    CFBundleExecutable: "FIAHost",
    CFBundleIdentifier: config.app.identifier,
    CFBundleName: config.app.name,
    CFBundleDisplayName: config.app.name,
    CFBundleShortVersionString: config.app.version,
    CFBundleVersion: String(config.app.build),
    CFBundlePackageType: "APPL",
    LSMinimumSystemVersion: "14.0",
    ...config.permissions,
    ...(config.app.icon ? { CFBundleIconFile: "AppIcon" } : {}),
  };
  return (
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
    Object.entries(values)
      .map(([key, value]) => "<key>" + xml(key) + "</key><string>" + xml(value) + "</string>")
      .join("") +
    "<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>"
  );
}
export function generatedBackendRunner(entry: string) {
  return (
    'import { runBackend } from "@semicoder/fia/backend";\n' +
    'const log = (...args) => process.stderr.write(args.map(x => typeof x === "string" ? x : Bun.inspect(x)).join(" ") + "\\n");\n' +
    "console.log = console.info = console.debug = console.warn = console.error = log;\n" +
    "const { default: backend } = await import(" +
    JSON.stringify(entry) +
    ");\nawait runBackend(backend);\n"
  );
}
export async function buildCode(
  config: ResolvedFIAConfig,
  destination: string,
  runner: ApplicationProcessRunner = defaultRunner,
  development = false,
): Promise<CodeRelease> {
  const assets = await verifyAssets();
  await mkdir(resolve(destination, "backend"), { recursive: true });
  await mkdir(resolve(destination, "web"), { recursive: true });
  const staging = resolve(config.projectRoot, ".fia/build");
  await mkdir(staging, { recursive: true });
  const entry = resolve(staging, "backend-runner.ts");
  await writeFile(entry, generatedBackendRunner(resolve(config.projectRoot, config.backend.entry)));
  if (development) {
    await cp(entry, resolve(destination, "backend/index.js"));
    await cp(
      resolve(config.projectRoot, config.web.root, "index.html"),
      resolve(destination, "web/index.html"),
    );
  } else {
    const vite = resolve(config.projectRoot, "node_modules/vite/bin/vite.js");
    await checked(runner, [process.execPath, vite, "build"], config.projectRoot);
    const result = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      format: "esm",
      outdir: resolve(destination, "backend"),
      naming: {
        entry: "index.[ext]",
        chunk: "chunks/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
      },
      packages: "bundle",
      minify: true,
    });
    if (!result.success) throw new AggregateError(result.logs, "Backend build failed");
    await cp(resolve(config.projectRoot, config.web.dist), resolve(destination, "web"), {
      recursive: true,
    });
  }
  for (const path of development ? [] : config.backend.assets)
    await cp(resolve(config.projectRoot, path), resolve(destination, "backend", path), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const release: CodeRelease = {
    schema: 1,
    identifier: config.app.identifier,
    version: config.app.version,
    build: config.app.build,
    runtimeId: await runtimeId(config, assets),
    baseURL: config.updates
      ? new URL("releases/" + config.app.build + "/", config.updates.url).href
      : "https://invalid.local/",
    ...(config.updates?.downloadURL ? { downloadURL: config.updates.downloadURL } : {}),
    files: await releaseFiles(destination),
  };
  await writeFile(resolve(destination, "manifest.json"), JSON.stringify(release, null, 2) + "\n");
  return release;
}
export async function buildApplication(
  config: ResolvedFIAConfig,
  options: {
    development?: boolean;
    distribution?: boolean;
    runner?: ApplicationProcessRunner;
  } = {},
) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("FIA requires macOS on Apple Silicon");
  const runner = options.runner ?? defaultRunner;
  await verifyAssets();
  const root = config.projectRoot;
  const parent = resolve(root, options.development ? ".fia/dev" : "dist");
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(resolve(parent, ".assemble-"));
  const app = resolve(temporary, config.app.name + ".app");
  const contents = resolve(app, "Contents");
  const resources = resolve(contents, "Resources");
  await mkdir(resolve(contents, "MacOS"), { recursive: true });
  await mkdir(resolve(contents, "Helpers"));
  await mkdir(resources);
  try {
    const release = await buildCode(
      config,
      resolve(resources, "code"),
      runner,
      options.development,
    );
    await cp(resolve(assetDirectory, "FIAHost"), resolve(contents, "MacOS/FIAHost"));
    await cp(resolve(assetDirectory, "bun"), resolve(contents, "Helpers/bun"));
    for (const path of ["MacOS/FIAHost", "Helpers/bun"])
      await chmod(resolve(contents, path), 0o755);
    if (config.app.icon)
      await cp(resolve(root, config.app.icon), resolve(resources, "AppIcon.icns"));
    const identity = options.distribution
      ? config.signing?.releaseIdentity
      : (config.signing?.developmentIdentity ?? "-");
    if (!identity) throw new Error("signing.releaseIdentity is required for distribution");
    const entitlements = resolve(temporary, "bun.entitlements.plist");
    await writeFile(
      entitlements,
      '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/><key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/></dict></plist>',
    );
    const sign = async (path: string, bun = false) =>
      checked(
        runner,
        [
          "/usr/bin/codesign",
          "--force",
          "--sign",
          identity,
          ...(identity === "-" ? [] : ["--timestamp", "--options", "runtime"]),
          ...(bun ? ["--entitlements", entitlements] : []),
          path,
        ],
        root,
      );
    await sign(resolve(contents, "Helpers/bun"), true);
    await sign(resolve(contents, "MacOS/FIAHost"));
    await writeFile(
      resolve(resources, "fia.runtime.json"),
      JSON.stringify(
        {
          schema: 3,
          frameworkVersion: CLI_VERSION,
          app: config.app,
          runtimeId: release.runtimeId,
          bunSHA256: await sha256(resolve(contents, "Helpers/bun")),
          ...(options.development
            ? {
                developmentEntry: resolve(resources, "code/backend/index.js").replace(
                  app,
                  resolve(parent, config.app.name + ".app"),
                ),
              }
            : {}),
          ...(config.statusItem ? { statusItem: config.statusItem } : {}),
          ...(config.updates ? { updates: config.updates } : {}),
        },
        null,
        2,
      ),
    );
    await writeFile(resolve(contents, "Info.plist"), infoPlist(config));
    await sign(app);
    await checked(runner, ["/usr/bin/codesign", "--verify", "--deep", "--strict", app], root);
    const destination = resolve(parent, config.app.name + ".app");
    const backup = destination + ".previous";
    await rm(backup, { recursive: true, force: true });
    let backedUp = false;
    try {
      await rename(destination, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(app, destination);
    } catch (error) {
      if (backedUp) await rename(backup, destination);
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
    return {
      app: destination,
      executable: resolve(destination, "Contents/MacOS/FIAHost"),
      release,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function releaseApplication(config: ResolvedFIAConfig, update = false) {
  if (update) {
    if (!config.updates)
      throw new Error("Configure updates.url and updates.publicKey before publishing code updates");
    const parent = resolve(config.projectRoot, "dist/updates");
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(resolve(parent, ".release-"));
    try {
      const release = await buildCode(config, staging);
      await rm(resolve(staging, "manifest.json"));
      const manifest = resolve(parent, "latest.json");
      const signed = resolve(parent, ".latest-" + crypto.randomUUID() + ".json");
      await writeSignedRelease(release, config.updates.publicKey, signed);
      const output = resolve(parent, "releases", String(config.app.build));
      await mkdir(dirname(output), { recursive: true });
      await rename(staging, output); // Immutable release IDs: never overwrite a previous build.
      await rename(signed, manifest);
      return { directory: parent, manifest, build: config.app.build };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  if (
    !config.signing?.releaseIdentity?.startsWith("Developer ID Application:") ||
    !config.signing.notarizationProfile
  )
    throw new Error("A Developer ID Application identity and notarizationProfile are required");
  const output = await buildApplication(config, { distribution: true });
  const zip = resolve(
    config.projectRoot,
    "dist",
    config.app.name + "-" + config.app.version + "-" + config.app.build + "-mac-arm64.zip",
  );
  const archive = async () => {
    await rm(zip, { force: true });
    await checked(
      defaultRunner,
      ["/usr/bin/ditto", "-c", "-k", "--keepParent", output.app, zip],
      config.projectRoot,
    );
  };
  await archive();
  await checked(
    defaultRunner,
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
  );
  await checked(
    defaultRunner,
    ["/usr/bin/xcrun", "stapler", "staple", output.app],
    config.projectRoot,
  );
  await checked(
    defaultRunner,
    ["/usr/bin/spctl", "--assess", "--type", "execute", "--verbose=4", output.app],
    config.projectRoot,
  );
  await archive();
  await writeFile(zip + ".sha256", (await sha256(zip)) + "  " + basename(zip) + "\n");
  const report = await smokeApplication(config, output.app);
  await writeFile(zip + ".report.json", JSON.stringify(report, null, 2));
  return { app: output.app, zip, report };
}
export async function runApplication(config: ResolvedFIAConfig) {
  const built = await buildApplication(config);
  const child = Bun.spawn([built.executable], {
    cwd: config.projectRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}
export function hasProcessExited(child: Pick<Bun.Subprocess, "exitCode" | "signalCode">) {
  // Bun leaves exitCode null when a process exits because of a signal.
  return child.exitCode !== null || child.signalCode !== null;
}
export async function runDevelopment(
  initial: ResolvedFIAConfig,
  output: (message: string) => void = console.log,
) {
  let stop = false;
  let control = "";
  let config = initial;
  const session = await createSession(
    config.projectRoot,
    () => {
      stop = true;
    },
    () => readInspection(control).then((x) => x ?? null),
    (event) => output("[" + event.component + "] " + (event.message ?? event.event)),
  );
  const onSignal = () => {
    stop = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    do {
      let changedConfig = false;
      const built = await buildApplication(config, { development: true });
      control = resolve(config.projectRoot, ".fia/dev/runtime-" + crypto.randomUUID());
      await mkdir(control, { mode: 0o700 });
      const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
      const vitePort = probe.port;
      await probe.stop(true);
      const host = Bun.spawn([built.executable], {
        cwd: config.projectRoot,
        // Let the CLI request orderly shutdown instead of terminal SIGINT killing
        // the host before it can stop its separately managed backend process group.
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          FIA_DEVELOPMENT: "1",
          FIA_CONTROL_DIRECTORY: control,
          FIA_DATA_DIRECTORY: resolve(config.projectRoot, ".fia/dev/data"),
          FIA_WEB_DEV_URL: "http://127.0.0.1:" + vitePort,
          FIA_DEV_READY_FILE: resolve(control, "vite.ready"),
        },
      });
      const drain = async (stream: ReadableStream<Uint8Array>, component: string) => {
        for await (const bytes of stream)
          session.emit({
            event: "log",
            component,
            message: new TextDecoder().decode(bytes).trim(),
          });
      };
      const drains = [drain(host.stdout, "host"), drain(host.stderr, "backend")];
      let vite: ReturnType<typeof Bun.spawn> | undefined;
      let watcher: ReturnType<typeof watch> | undefined;
      let debounce: ReturnType<typeof setTimeout> | undefined;
      try {
        const endpoint = await waitUntil(
          async () => {
            if (hasProcessExited(host)) throw new Error("Host exited before its backend was ready");
            try {
              return JSON.parse(await readFile(resolve(control, "backend.json"), "utf8")) as {
                origin: string;
              };
            } catch {
              return undefined;
            }
          },
          15_000,
          "Bun endpoint",
        );
        vite = Bun.spawn(
          [
            process.execPath,
            resolve(config.projectRoot, "node_modules/vite/bin/vite.js"),
            "--host",
            "127.0.0.1",
            "--port",
            String(vitePort),
            "--strictPort",
          ],
          {
            cwd: config.projectRoot,
            detached: true,
            env: {
              ...process.env,
              FIA_BACKEND_ORIGIN: endpoint.origin,
              FIA_BACKEND_ENDPOINT_FILE: resolve(control, "backend.json"),
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        drains.push(
          drain(vite.stdout as ReadableStream<Uint8Array>, "vite"),
          drain(vite.stderr as ReadableStream<Uint8Array>, "vite"),
        );
        await waitUntil(
          async () => {
            if (hasProcessExited(vite!)) throw new Error("Vite failed to start");
            try {
              return (await fetch("http://127.0.0.1:" + vitePort)).ok ? true : undefined;
            } catch {
              return undefined;
            }
          },
          15_000,
          "Vite",
        );
        await writeFile(resolve(control, "vite.ready"), "");
        session.emit({
          event: "ready",
          component: "dev",
          message: "Application ready; frontend HMR and backend restart enabled",
        });
        watcher = watch(config.projectRoot, { recursive: true }, (_event, file) => {
          const path = file?.toString();
          if (
            !path ||
            /^(node_modules|\.git|\.fia|dist)\//u.test(path) ||
            path.startsWith(config.web.root + "/")
          )
            return;
          if (["fia.config.ts", "vite.config.ts", "package.json", "bun.lock"].includes(path)) {
            changedConfig = true;
            return;
          }
          const assetChanged = config.backend.assets.some(
            (asset) => path === asset || path.startsWith(asset + "/"),
          );
          if (!assetChanged && !/\.(?:[cm]?[jt]sx?|json)$/u.test(path)) return;
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            void writeFile(resolve(control, "reload"), "");
          }, 150);
        });
        while (!stop && !changedConfig) {
          if (hasProcessExited(host)) {
            stop = true;
            break;
          }
          if (hasProcessExited(vite)) throw new Error("Vite exited unexpectedly");
          await Bun.sleep(100);
        }
      } finally {
        watcher?.close();
        clearTimeout(debounce);
        await writeFile(resolve(control, "quit"), "");
        try {
          await waitUntil(
            async () => (hasProcessExited(host) ? true : undefined),
            20_000,
            "Host shutdown",
          );
        } finally {
          if (!hasProcessExited(host)) {
            host.kill("SIGTERM");
            await host.exited;
          }
          if (vite) {
            vite.kill("SIGTERM");
            await vite.exited;
          }
          await Promise.all(drains);
        }
      }
      if (changedConfig && !stop) config = await loadProjectConfig(config.projectRoot);
    } while (!stop);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await session.close();
  }
}
