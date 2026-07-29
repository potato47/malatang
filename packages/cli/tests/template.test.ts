import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProject } from "../src/create.ts";
import { isDefinedMcpServer } from "../src/mcp-server.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function generatedProject(mcp: boolean): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), `fia-template-${mcp ? "mcp" : "ui"}-`));
  temporaryDirectories.push(cwd);
  const project = await createProject({
    name: "template-app",
    cwd,
    mcp,
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
    "zod",
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

describe("generated MCP React template", () => {
  test("typechecks MCP and UI-only projects against the published FIA API", async () => {
    for (const mcp of [true, false]) {
      const project = await generatedProject(mcp);
      const child = Bun.spawn(
        [
          process.execPath,
          resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "-p",
          resolve(project, "tsconfig.json"),
        ],
        { cwd: project, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0)
        throw new Error(
          `Generated ${mcp ? "MCP" : "UI-only"} template did not typecheck:\n${stdout}${stderr}`,
        );
    }
  });

  test("exports a marked synchronous MCP server factory", async () => {
    const project = await generatedProject(true);
    const module = (await import(
      `${pathToFileURL(resolve(project, "src/mcp/server.ts")).href}?test=${crypto.randomUUID()}`
    )) as { default: unknown };
    expect(isDefinedMcpServer(module.default)).toBe(true);
  });
});
