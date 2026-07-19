import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createProject, CreateProjectError, type CreateProcessRunner } from "../src/create.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "fia-create-test-"));
  temporaryDirectories.push(root);
  return root;
}

function output(): { values: string[]; io: { stdout(value: string): void } } {
  const values: string[] = [];
  return { values, io: { stdout: (value) => values.push(value) } };
}

describe("FIA project creation", () => {
  test("generates the complete React template without installing", async () => {
    const cwd = await workspace();
    const messages = output();
    const project = await createProject({
      name: "hello-world",
      cwd,
      install: false,
      initializeGit: false,
      io: messages.io,
      dependencies: { cliPackageSpec: "file:../cli" },
    });

    expect(project).toBe(resolve(cwd, "hello-world"));
    const files = [
      ".gitignore",
      "AGENTS.md",
      "README.md",
      "fia.config.ts",
      "package.json",
      "src/server.ts",
      "src/ui/App.tsx",
      "src/ui/index.html",
      "src/ui/main.tsx",
      "src/ui/style.css",
      "tsconfig.json",
    ];
    for (const file of files) expect(await Bun.file(resolve(project, file)).exists()).toBe(true);

    const metadata = JSON.parse(await readFile(resolve(project, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(metadata).toMatchObject({ name: "hello-world" });
    expect(metadata.dependencies).toEqual({ react: "^19.2.7", "react-dom": "^19.2.7" });
    expect(metadata.devDependencies["@semicoder/fia"]).toBe("file:../cli");
    expect(metadata.scripts).toMatchObject({ dev: "fia dev", build: "fia build", run: "fia run" });

    const config = await readFile(resolve(project, "fia.config.ts"), "utf8");
    expect(config).toContain('name: "Hello World"');
    expect(config).toContain('identifier: "com.example.hello-world"');
    expect(config).toContain('ui: "src/ui/index.html"');
    const agentGuide = await readFile(resolve(project, "AGENTS.md"), "utf8");
    expect(agentGuide).toContain("Agent guide for Hello World");
    expect(agentGuide).toContain("@semicoder/fia/native");
    expect(agentGuide).toContain("native.isAvailable()");
    expect(agentGuide).not.toContain("__FIA_DISPLAY_NAME__");
    expect(await readFile(resolve(project, "src/server.ts"), "utf8")).toContain("defineApp");
    expect(messages.values.join("")).toContain("bun install");
    expect(messages.values.join("")).toContain("bun run dev");
  });

  test("installs by default and initializes Git only when requested", async () => {
    const cwd = await workspace();
    const calls: Array<{ command: readonly string[]; cwd: string }> = [];
    const runner: CreateProcessRunner = async (command, commandCwd) => {
      calls.push({ command, cwd: commandCwd });
      return 0;
    };

    await createProject({
      name: "with-git",
      cwd,
      install: true,
      initializeGit: true,
      io: output().io,
      dependencies: { runner },
    });

    expect(calls.map((call) => call.command)).toEqual([
      [process.execPath, "install"],
      ["git", "init"],
    ]);
    expect(calls.every((call) => call.cwd.includes(".fia-create-with-git-"))).toBe(true);
  });

  test("rejects unsafe names and existing targets", async () => {
    const cwd = await workspace();
    for (const name of ["Hello", "hello_world", "hello/world", "hello--world", "hello-"]) {
      await expect(createProject({
        name,
        cwd,
        install: false,
        initializeGit: false,
        io: output().io,
      })).rejects.toBeInstanceOf(CreateProjectError);
    }
    await mkdir(resolve(cwd, "existing"));
    await expect(createProject({
      name: "existing",
      cwd,
      install: false,
      initializeGit: false,
      io: output().io,
    })).rejects.toThrow("target already exists");
  });

  test("rolls back the temporary project when an external command fails", async () => {
    const cwd = await workspace();
    const runner: CreateProcessRunner = async () => 7;
    await expect(createProject({
      name: "rollback",
      cwd,
      install: true,
      initializeGit: false,
      io: output().io,
      dependencies: { runner },
    })).rejects.toThrow("bun install failed with exit code 7");

    expect(await Bun.file(resolve(cwd, "rollback/package.json")).exists()).toBe(false);
    expect((await readdir(cwd)).filter((name) => name.startsWith(".fia-create-"))).toEqual([]);

    await expect(createProject({
      name: "spawn-failure",
      cwd,
      install: true,
      initializeGit: false,
      io: output().io,
      dependencies: { runner: async () => { throw new Error("spawn failed"); } },
    })).rejects.toThrow("bun install could not start");
    expect(await Bun.file(resolve(cwd, "spawn-failure/package.json")).exists()).toBe(false);
  });
});
