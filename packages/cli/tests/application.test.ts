import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  executeApplicationCommand,
  generatedMcpRunner,
  injectCSPNonce,
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

async function project(name: string, mcp = true): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-application-v3-"));
  temporaryDirectories.push(cwd);
  const root = await createProject({
    name,
    cwd,
    mcp,
    install: false,
    initializeGit: false,
    io: { stdout: () => {} },
    dependencies: { cliPackageSpec: `file:${packageRoot}` },
  });
  const modules = resolve(root, "node_modules");
  await mkdir(resolve(modules, "@base-ui"), { recursive: true });
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(
    resolve(packageRoot, "node_modules/@base-ui/react"),
    resolve(modules, "@base-ui/react"),
    "dir",
  );
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  for (const [name, source] of [
    ["typescript", resolve(repositoryRoot, "node_modules/typescript")],
    ["class-variance-authority", resolve(packageRoot, "node_modules/class-variance-authority")],
    ["clsx", resolve(packageRoot, "node_modules/clsx")],
    ["lucide-react", resolve(packageRoot, "node_modules/lucide-react")],
    ["react", resolve(packageRoot, "node_modules/react")],
    ["react-dom", resolve(packageRoot, "node_modules/react-dom")],
    ["tailwind-merge", resolve(packageRoot, "node_modules/tailwind-merge")],
    ["zod", resolve(packageRoot, "node_modules/zod")],
  ] as const) {
    await symlink(source, resolve(modules, name), "dir");
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
  return root;
}

function output(): {
  stdout: string[];
  stderr: string[];
  io: { stdout(value: string): void; stderr(value: string): void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
  };
}

describe("FIA MCP application packaging", () => {
  test("injects CSP nonces without rewriting script text", () => {
    const html = '<style>.x{}</style><script>const x = "<script>";</script>';
    expect(injectCSPNonce(html, "nonce")).toBe(
      '<style nonce="nonce">.x{}</style><script nonce="nonce">const x = "<script>";</script>',
    );
  });

  test("generates a modern-only stdio runner", () => {
    const runner = generatedMcpRunner("/project/src/mcp/server.ts");
    expect(runner).toContain("isDefinedMcpServer");
    expect(runner).toContain('serveStdio(factory, { legacy: "reject"');
    expect(runner).not.toContain("initialize");
  });

  test("builds static UI plus a standalone signed app MCP server", async () => {
    const root = await project("mcp-build");
    const messages = output();
    await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: messages.io });
    const app = resolve(root, "dist/Mcp Build.app");
    expect(await Bun.file(resolve(app, "Contents/MacOS/FIAHost")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/Resources/UI/index.html")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/Helpers/MCPServers/app")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/MacOS/fia-runtime")).exists()).toBe(false);
    expect(await Bun.file(resolve(app, "Contents/MacOS/fia-backend")).exists()).toBe(false);
    const config = JSON.parse(
      await readFile(resolve(app, "Contents/Resources/fia-config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      schemaVersion: 5,
      bridgeVersion: 1,
      mcpProtocolVersion: "2026-07-28",
      ui: { mode: "bundled", entry: "UI/index.html", url: null },
      mcpServers: [
        {
          id: "app",
          executable: "Helpers/MCPServers/app",
          arguments: [],
        },
      ],
      nativeCapabilities: ["tools", "resources", "subscriptions"],
    });
    const signedServer = resolve(app, "Contents/Helpers/MCPServers/app");
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(signedServer).arrayBuffer());
    expect((config.mcpServers as Array<{ sha256: string }>)[0]?.sha256).toBe(hasher.digest("hex"));
    const transport = new StdioClientTransport({
      command: signedServer,
      cwd: root,
      stderr: "inherit",
    });
    const client = new Client(
      { name: "fia-packaged-e2e", version: "0.5.0" },
      {
        versionNegotiation: {
          mode: { pin: "2026-07-28" },
          probe: { timeoutMs: 10_000, maxRetries: 0 },
        },
      },
    );
    try {
      await client.connect(transport, { timeout: 10_000 });
      const greeting = await client.callTool(
        { name: "greet", arguments: { name: "FIA" } },
        { timeout: 10_000 },
      );
      expect(greeting.structuredContent).toMatchObject({ message: "Hello, FIA!" });
    } finally {
      await client.close();
    }
    expect(messages.stdout.join("")).toContain(`Built ${app}`);
  }, 40_000);

  test("builds a pure UI application without an app server", async () => {
    const root = await project("ui-build", false);
    await executeApplicationCommand({ command: "build", cwd: root, debug: false, io: output().io });
    const app = resolve(root, "dist/Ui Build.app");
    expect(await Bun.file(resolve(app, "Contents/Resources/UI/index.html")).exists()).toBe(true);
    expect(await Bun.file(resolve(app, "Contents/Helpers/MCPServers/app")).exists()).toBe(false);
    const config = JSON.parse(
      await readFile(resolve(app, "Contents/Resources/fia-config.json"), "utf8"),
    ) as { mcpServers: unknown[] };
    expect(config.mcpServers).toEqual([]);
  }, 30_000);
});
