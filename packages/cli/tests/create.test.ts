import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject, CreateProjectError, type CreateProcessRunner } from "../src/create.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-create-v3-"));
  temporaryDirectories.push(root);
  return root;
}

const io = { stdout: (_value: string): void => {} };

describe("FIA project creation", () => {
  test("generates a Bun MCP server by default", async () => {
    const cwd = await workspace();
    const root = await createProject({
      name: "hello-mcp",
      cwd,
      install: false,
      initializeGit: false,
      io,
      dependencies: { cliPackageSpec: "file:../cli" },
    });
    for (const file of [
      "fia.config.ts",
      "src/mcp/server.ts",
      "src/shared/types.ts",
      "src/ui/App.tsx",
      "src/ui/index.html",
      "package.json",
      "AGENTS.md",
    ]) {
      expect(await Bun.file(resolve(root, file)).exists()).toBe(true);
    }
    const config = await readFile(resolve(root, "fia.config.ts"), "utf8");
    expect(config).toContain("configVersion: 3");
    expect(config).toContain('entry: "src/mcp/server.ts"');
    expect(config).toContain('watch: ["src/mcp", "src/shared"]');
    const server = await readFile(resolve(root, "src/mcp/server.ts"), "utf8");
    expect(server).toContain("defineMcpServer");
    expect(server).toContain('registerTool(\n    "greet"');
    const app = await readFile(resolve(root, "src/ui/App.tsx"), "utf8");
    expect(app).toContain('mcp.server("app").callTool');
    const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(metadata.dependencies.zod).toBe("^4.2.0");
    expect(metadata.devDependencies["@semicoder/fia"]).toBe("file:../cli");
  });

  test("supports --no-mcp UI-only generation", async () => {
    const cwd = await workspace();
    const root = await createProject({
      name: "ui-only",
      cwd,
      mcp: false,
      install: false,
      initializeGit: false,
      io,
    });
    expect(await Bun.file(resolve(root, "src/mcp/server.ts")).exists()).toBe(false);
    expect(await readFile(resolve(root, "fia.config.ts"), "utf8")).not.toContain("mcp:");
    const app = await readFile(resolve(root, "src/ui/App.tsx"), "utf8");
    expect(app).toContain("@semicoder/fia/native");
    expect(app).not.toContain('mcp.server("app")');
  });

  test("installs and initializes git only when requested", async () => {
    const cwd = await workspace();
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const runner: CreateProcessRunner = async (command) => {
      mutableCalls.push([...command]);
      return 0;
    };
    await createProject({
      name: "with-git",
      cwd,
      install: true,
      initializeGit: true,
      io,
      dependencies: { runner },
    });
    expect(calls).toEqual([
      [process.execPath, "install"],
      ["git", "init"],
    ]);
  });

  test("rejects unsafe names, existing targets, and rolls back failures", async () => {
    const cwd = await workspace();
    await expect(
      createProject({
        name: "../unsafe",
        cwd,
        install: false,
        initializeGit: false,
        io,
      }),
    ).rejects.toBeInstanceOf(CreateProjectError);
    await mkdir(resolve(cwd, "existing"));
    await expect(
      createProject({
        name: "existing",
        cwd,
        install: false,
        initializeGit: false,
        io,
      }),
    ).rejects.toThrow("target already exists");
    await expect(
      createProject({
        name: "rollback",
        cwd,
        install: true,
        initializeGit: false,
        io,
        dependencies: { runner: async () => 7 },
      }),
    ).rejects.toThrow("bun install failed");
    expect((await readdir(cwd)).some((name) => name.startsWith(".fia-create-"))).toBe(false);
  });
});
