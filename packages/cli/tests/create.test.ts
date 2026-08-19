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
  const root = await mkdtemp(resolve(tmpdir(), "fia-create-v5-"));
  temporaryDirectories.push(root);
  return root;
}
const io = { stdout: (_value: string): void => {} };

describe("FIA project creation", () => {
  test("generates a resident Bun backend with a React HTTP/WS client", async () => {
    const root = await createProject({
      name: "hello-service",
      cwd: await workspace(),
      install: false,
      initializeGit: false,
      io,
      dependencies: { cliPackageSpec: "file:../cli" },
    });
    for (const file of [
      "fia.config.ts",
      "src/backend.ts",
      "src/ui/App.tsx",
      "src/ui/index.html",
      "src/ui/components/ui/index.ts",
      "package.json",
      "AGENTS.md",
    ])
      expect(await Bun.file(resolve(root, file)).exists()).toBe(true);
    const config = await readFile(resolve(root, "fia.config.ts"), "utf8");
    expect(config).toContain("configVersion: 5");
    expect(config).toContain('entry: "src/backend.ts"');
    expect(config).not.toContain("mcp:");
    const backend = await readFile(resolve(root, "src/backend.ts"), "utf8");
    expect(backend).toContain("defineBackend");
    expect(backend).toContain("desktop.windows.create");
    expect(backend).toContain("desktop.tray.setMenu");
    expect(backend).not.toContain("globalThis");
    expect(backend).not.toContain("stop()");
    const app = await readFile(resolve(root, "src/ui/App.tsx"), "utf8");
    expect(app).toContain('fetch("/api/greet")');
    expect(app).toContain("new WebSocket");
    expect(app).not.toContain("@semicoder/fia");
    const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(metadata.dependencies).not.toHaveProperty("zod");
    expect(metadata.devDependencies["@semicoder/fia"]).toBe("file:../cli");
    expect(metadata.scripts.package).toBe("fia package");
    expect(metadata.scripts.release).toBe("fia release");
  });

  test("installs and initializes git only when requested", async () => {
    const calls: string[][] = [];
    const runner: CreateProcessRunner = async (command) => {
      calls.push([...command]);
      return 0;
    };
    await createProject({
      name: "with-git",
      cwd: await workspace(),
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

  test("rejects unsafe targets and rolls back failures", async () => {
    const cwd = await workspace();
    await expect(
      createProject({ name: "../unsafe", cwd, install: false, initializeGit: false, io }),
    ).rejects.toBeInstanceOf(CreateProjectError);
    await mkdir(resolve(cwd, "existing"));
    await expect(
      createProject({ name: "existing", cwd, install: false, initializeGit: false, io }),
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
