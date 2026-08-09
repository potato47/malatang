import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { executeApplicationCommand, generatedBackendRunner } from "../src/application.ts";
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
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-application-v4-"));
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
  await mkdir(resolve(modules, "@base-ui"), { recursive: true });
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(
    resolve(packageRoot, "node_modules/@base-ui/react"),
    resolve(modules, "@base-ui/react"),
    "dir",
  );
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  await symlink(
    resolve(repositoryRoot, "node_modules/typescript"),
    resolve(modules, "typescript"),
    "dir",
  );
  for (const dependency of [
    "bun-plugin-tailwind",
    "class-variance-authority",
    "clsx",
    "lucide-react",
    "react",
    "react-dom",
    "tailwind-merge",
    "tailwindcss",
  ] as const) {
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
      v: 1,
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
            `${JSON.stringify({ v: 1, type: "response", id: frame.id, result: null })}\n`,
          );
          input.flush();
        } else if (frame.type === "ready" && typeof frame.origin === "string") {
          origin = frame.origin;
        }
      }
    }
    const htmlResponse = await fetch(origin);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
    if (stylesheet === undefined) throw new Error("Packaged HTML has no stylesheet");
    const cssResponse = await fetch(new URL(stylesheet, origin));
    expect(cssResponse.status).toBe(200);
    const css = await cssResponse.text();
    input.write(`${JSON.stringify({ v: 1, type: "event", event: "host.shutdown" })}\n`);
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
  test("generates a protocol-clean dynamic Backend runner", () => {
    const runner = generatedBackendRunner("/project/src/backend.ts");
    expect(runner).toContain("runBackend");
    expect(runner).toContain("console.log = writeLog");
    expect(runner).toContain('await import("/project/src/backend.ts")');
    expect(runner).not.toContain("MCP");
  });

  test("builds one signed standalone Backend without packaged UI or MCP directories", async () => {
    const root = await linkedProject();
    const messages = output();
    await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: messages.io });
    const app = resolve(root, "dist/Packaged Service.app");
    const backend = resolve(app, "Contents/Helpers/FIABackend");
    expect(await Bun.file(backend).exists()).toBe(true);
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
      schemaVersion: 6,
      stdioProtocolVersion: 1,
      backend: { executable: "Helpers/FIABackend" },
      hostCapabilities: ["application", "statusItem", "webviews", "system"],
    });
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(backend).arrayBuffer());
    expect(config.backend.sha256).toBe(hasher.digest("hex"));
    expect(await readFile(resolve(app, "Contents/Info.plist"), "utf8")).toContain(
      "<key>LSUIElement</key><true/>",
    );
    const css = await packagedStylesheet(backend, root);
    expect(css).toMatch(/\.flex\{/);
    expect(css).toMatch(/\.min-h-screen\{/);
    expect(messages.stdout.join("")).toContain("Built");
  }, 60_000);
});
