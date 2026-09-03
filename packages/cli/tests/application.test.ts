import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  backendDistributionEntitlements,
  codeSigningCommand,
  developmentBackendRunnerPath,
  distributionArchiveCommand,
  distributionArchiveName,
  executeApplicationCommand,
  generatedBackendRunner,
  hasCodeSigningIdentity,
  hasExpectedHostCapabilities,
  notarizationSubmitCommand,
  parseNotarizationResponse,
  parseCodeSigningIdentities,
} from "../src/application.ts";
import { createProject } from "../src/create.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function linkedProject(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-application-v5-"));
  temporaryDirectories.push(cwd);
  const project = await createProject({
    name: "packaged-service",
    cwd,
    install: false,
    initializeGit: false,
    io: { stdout: () => {} },
    dependencies: { cliPackageSpec: `file:${packageRoot}` },
  });
  const modules = resolve(project, "node_modules");
  await mkdir(resolve(modules, ".bin"), { recursive: true });
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  await symlink(resolve(packageRoot, "bin/fia"), resolve(modules, ".bin/fia"));
  await symlink(
    resolve(repositoryRoot, "node_modules/typescript"),
    resolve(modules, "typescript"),
    "dir",
  );
  for (const dependency of ["bun-plugin-tailwind", "react", "react-dom", "tailwindcss"] as const) {
    await symlink(
      resolve(packageRoot, "node_modules", dependency),
      resolve(modules, dependency),
      "dir",
    );
  }
  for (const dependency of ["bun", "react", "react-dom"] as const) {
    await symlink(
      dependency === "bun"
        ? resolve(repositoryRoot, "node_modules/@types/bun")
        : resolve(packageRoot, "node_modules/@types", dependency),
      resolve(modules, "@types", dependency),
      "dir",
    );
  }
  return project;
}

async function configureCustomNativeArtifacts(projectRoot: string): Promise<void> {
  const native = resolve(projectRoot, "native");
  const source = resolve(packageRoot, "assets/host/darwin-arm64/FIAHost");
  const host = resolve(native, "AIXHost");
  const helper = resolve(native, "aix");
  await mkdir(native, { recursive: true });
  await Promise.all([copyFile(source, host), copyFile(source, helper)]);
  await Promise.all([chmod(host, 0o755), chmod(helper, 0o755)]);
  const configPath = resolve(projectRoot, "fia.config.ts");
  const config = await readFile(configPath, "utf8");
  await writeFile(
    configPath,
    config.replace(
      "  statusBar:",
      '  host: { executable: "native/AIXHost", name: "AIXHost" },\n' +
        '  helpers: [{ executable: "native/aix", name: "aix" }],\n' +
        "  statusBar:",
    ),
  );
}

async function launchPackagedHost(executable: string, projectRoot: string): Promise<void> {
  const child = Bun.spawn([executable], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FIA_INTERNAL_AUTO_QUIT_MS: "750",
      FIA_INTERNAL_DIAGNOSTICS: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = new Response(child.stderr).text();
  const exitCode = await Promise.race([child.exited, Bun.sleep(10_000).then(() => undefined)]);
  if (exitCode === undefined) {
    child.kill("SIGKILL");
    throw new Error(`Custom Host launch smoke timed out: ${await stderr}`);
  }
  if (exitCode !== 0)
    throw new Error(`Custom Host exited with status ${exitCode}: ${await stderr}`);
}

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  };
}

async function directText(url: string | URL): Promise<{ status: number; body: string }> {
  return new Promise((resolveResponse, reject) => {
    const request = get(url, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.once("end", () => {
        resolveResponse({ status: response.statusCode ?? 0, body });
      });
      response.once("error", reject);
    });
    request.once("error", reject);
  });
}

async function packagedStylesheet(backend: string, projectRoot: string): Promise<string> {
  const child = Bun.spawn([backend], {
    cwd: projectRoot,
    env: {},
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const input = child.stdin;
  if (input === undefined || typeof input === "number") throw new Error("missing Backend stdin");
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let origin: string | undefined;
  input.write(
    `${JSON.stringify({
      v: 2,
      type: "initialize",
      sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
      preferredPort: 0,
      development: false,
      applicationSupport: resolve(projectRoot, ".fia/test-support"),
      app: { name: "Packaged Service", identifier: "com.example.packaged-service" },
    })}\n`,
  );
  input.flush();
  try {
    const deadline = Date.now() + 10_000;
    while (origin === undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Backend readiness timed out");
      const item = await Promise.race([reader.read(), Bun.sleep(remaining).then(() => undefined)]);
      if (item === undefined) throw new Error("Backend readiness timed out");
      if (item.done) throw new Error("Backend exited before ready");
      buffer += decoder.decode(item.value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, newline)) as {
          type?: string;
          id?: number;
          origin?: string;
        };
        buffer = buffer.slice(newline + 1);
        if (frame.type === "request" && typeof frame.id === "number") {
          input.write(
            `${JSON.stringify({ v: 2, type: "response", id: frame.id, result: null })}\n`,
          );
          input.flush();
        } else if (frame.type === "ready" && typeof frame.origin === "string") {
          origin = frame.origin;
        }
      }
    }
    const htmlResponse = await directText(origin);
    expect(htmlResponse.status).toBe(200);
    const html = htmlResponse.body;
    const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
    if (stylesheet === undefined) throw new Error("Packaged HTML has no stylesheet");
    const cssResponse = await directText(new URL(stylesheet, origin));
    expect(cssResponse.status).toBe(200);
    const css = cssResponse.body;
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    return css;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL");
    const diagnostic = (await stderr).trim();
    throw new Error(diagnostic.length > 0 ? diagnostic : String(error), { cause: error });
  } finally {
    reader.releaseLock();
    input.end();
  }
}

describe("FIA resident Backend application packaging", () => {
  test("matches configured code signing identities by exact allowed identity name", () => {
    const output =
      '  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Developer ID Application: Example (TEAMID)"\n' +
      "     1 valid identities found\n";
    expect(parseCodeSigningIdentities(output)).toEqual([
      {
        name: "Developer ID Application: Example (TEAMID)",
      },
    ]);
    expect(hasCodeSigningIdentity(output, "Developer ID Application: Example (TEAMID)")).toBe(true);
    expect(hasCodeSigningIdentity(output, "abcdef0123456789abcdef0123456789abcdef01")).toBe(false);
    expect(hasCodeSigningIdentity(output, "Developer ID Application: Missing (TEAMID)")).toBe(
      false,
    );
  });

  test("builds explicit development and hardened distribution signing commands", () => {
    const identity = "Apple Development: Example (TEAMID)";
    expect(codeSigningCommand(identity, "/tmp/FIABackend")).toEqual([
      "/usr/bin/codesign",
      "--force",
      "--sign",
      identity,
      "/tmp/FIABackend",
    ]);
    const distributionIdentity = "Developer ID Application: Example (TEAMID)";
    expect(
      codeSigningCommand(distributionIdentity, "/tmp/FIABackend", {
        distribution: true,
        entitlements: "/tmp/backend.entitlements",
      }),
    ).toEqual([
      "/usr/bin/codesign",
      "--force",
      "--sign",
      distributionIdentity,
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      "/tmp/backend.entitlements",
      "/tmp/FIABackend",
    ]);
    expect(
      codeSigningCommand(distributionIdentity, "/tmp/Example.app", { distribution: true }),
    ).toEqual([
      "/usr/bin/codesign",
      "--force",
      "--sign",
      distributionIdentity,
      "--options",
      "runtime",
      "--timestamp",
      "/tmp/Example.app",
    ]);
  });

  test("builds deterministic ZIP and notarytool commands", () => {
    expect(distributionArchiveName({ app: { name: "Example", version: "1.2.3" } })).toBe(
      "Example-1.2.3-mac-arm64.zip",
    );
    expect(distributionArchiveCommand("/tmp/Example.app", "/tmp/Example.zip")).toEqual([
      "/usr/bin/ditto",
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      "/tmp/Example.app",
      "/tmp/Example.zip",
    ]);
    expect(notarizationSubmitCommand("/tmp/Example.zip", "fia-notary")).toEqual([
      "/usr/bin/xcrun",
      "notarytool",
      "submit",
      "/tmp/Example.zip",
      "--keychain-profile",
      "fia-notary",
      "--wait",
      "--timeout",
      "60m",
      "--output-format",
      "json",
    ]);
  });

  test("parses structured notarytool results", () => {
    expect(
      parseNotarizationResponse(
        JSON.stringify({ id: "submission-id", status: "Accepted", message: "success" }),
      ),
    ).toEqual({ id: "submission-id", status: "Accepted", message: "success" });
    expect(parseNotarizationResponse(JSON.stringify({ status: 7, extra: true }))).toEqual({});
    expect(() => parseNotarizationResponse("not-json")).toThrow("notarytool returned invalid JSON");
  });

  test("grants only the Bun JIT hardened-runtime exception to the Backend", () => {
    const entitlements = backendDistributionEntitlements();
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(entitlements).not.toContain("get-task-allow");
    expect(entitlements).not.toContain("disable-library-validation");
    expect(entitlements).not.toContain("allow-unsigned-executable-memory");
  });

  test("requires the exact ordered Host capability array", () => {
    const expected = [
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
    expect(hasExpectedHostCapabilities(expected)).toBe(true);
    expect(hasExpectedHostCapabilities(undefined)).toBe(false);
    expect(hasExpectedHostCapabilities(expected.join(","))).toBe(false);
    expect(hasExpectedHostCapabilities(["application,statusItem", ...expected.slice(2)])).toBe(
      false,
    );
  });

  test("generates a protocol-clean dynamic Backend runner", () => {
    const runner = generatedBackendRunner("/project/backend/index.ts");
    expect(runner).toContain("runBackend");
    expect(runner).toContain("console.log = writeLog");
    expect(runner).toContain('await import("/project/backend/index.ts")');
    expect(runner).not.toContain("MCP");
  });

  test("uses one stable development runner path across temporary app builds", () => {
    const root = "/project";
    expect(developmentBackendRunnerPath(root)).toBe("/project/.fia/dev/backend-runner.ts");
  });

  test("requires a separate Developer ID identity for package", async () => {
    const root = await linkedProject();
    await expect(
      executeApplicationCommand({ command: "package", cwd: root, debug: false, io: output().io }),
    ).rejects.toThrow("release.identity is required for fia package");
  });

  test("builds through bun run while a configured HTTP proxy returns 502", async () => {
    const root = await linkedProject();
    await configureCustomNativeArtifacts(root);
    let proxyRequests = 0;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        proxyRequests += 1;
        return new Response("Bad Gateway", {
          status: 502,
          headers: { "proxy-connection": "close" },
        });
      },
    });
    const child = Bun.spawn([process.execPath, "run", "build"], {
      cwd: root,
      env: {
        ...process.env,
        HTTP_PROXY: proxy.url.href,
        http_proxy: proxy.url.href,
        NO_PROXY: "",
        no_proxy: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutText = new Response(child.stdout).text();
    const stderrText = new Response(child.stderr).text();
    let exitCode: number;
    try {
      exitCode = await child.exited;
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      proxy.stop(true);
    }
    const messages = { stdout: await stdoutText, stderr: await stderrText };
    if (exitCode !== 0) {
      throw new Error(`fia build exited with status ${exitCode}: ${messages.stderr}`);
    }
    expect(proxyRequests).toBe(0);
    const app = resolve(root, "dist/Packaged Service.app");
    const backend = resolve(app, "Contents/Helpers/FIABackend");
    const host = resolve(app, "Contents/MacOS/AIXHost");
    const helper = resolve(app, "Contents/Helpers/aix");
    expect(await Bun.file(backend).exists()).toBe(true);
    expect(await Bun.file(host).exists()).toBe(true);
    expect(await Bun.file(helper).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIAHost")).exists()).toBe(false);
    expect(await Bun.file(resolve(app, "Contents/Resources/UI")).exists()).toBe(false);
    expect(await Bun.file(resolve(app, "Contents/Helpers/MCPServers")).exists()).toBe(false);
    const config = JSON.parse(
      await readFile(resolve(app, "Contents/Resources/fia-config.json"), "utf8"),
    ) as {
      schemaVersion: number;
      stdioProtocolVersion: number;
      backend: { executable: string; sha256: string };
      hostCapabilities: string[];
    };
    expect(config).toMatchObject({
      schemaVersion: 8,
      stdioProtocolVersion: 2,
      backend: { executable: "Helpers/FIABackend" },
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
    });
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(backend).arrayBuffer());
    expect(config.backend.sha256).toBe(hasher.digest("hex"));
    const plist = await readFile(resolve(app, "Contents/Info.plist"), "utf8");
    expect(plist).toContain("<key>LSUIElement</key><true/>");
    expect(plist).toContain("<key>CFBundleExecutable</key><string>AIXHost</string>");
    const css = await packagedStylesheet(backend, root);
    expect(css).toMatch(/\.flex\{/);
    expect(css).toMatch(/\.min-h-screen\{/);
    expect(messages.stdout).toContain("Built");
    expect(messages.stderr).toContain("using ad-hoc signing");
    await launchPackagedHost(host, root);
  }, 60_000);
});
