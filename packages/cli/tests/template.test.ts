import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProject } from "../src/create.ts";
import { isFIAApplication, type DefinedFIAApplication } from "../src/runtime.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function generatedProject(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-template-test-"));
  temporaryDirectories.push(cwd);
  const project = await createProject({
    name: "template-app",
    cwd,
    install: false,
    initializeGit: false,
    io: { stdout: () => {} },
    dependencies: { cliPackageSpec: `file:${packageRoot}` },
  });

  const modules = resolve(project, "node_modules");
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  for (const dependency of ["react", "react-dom"] as const) {
    await symlink(resolve(packageRoot, "node_modules", dependency), resolve(modules, dependency), "dir");
  }
  await symlink(resolve(repositoryRoot, "node_modules/typescript"), resolve(modules, "typescript"), "dir");
  await symlink(
    resolve(repositoryRoot, "node_modules/@types/bun"),
    resolve(modules, "@types/bun"),
    "dir",
  );
  for (const dependency of ["react", "react-dom"] as const) {
    await symlink(
      resolve(packageRoot, "node_modules/@types", dependency),
      resolve(modules, "@types", dependency),
      "dir",
    );
  }
  return project;
}

async function commandOutput(command: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

describe("generated React template", () => {
  test("typechecks with the published config entry", async () => {
    const project = await generatedProject();
    const result = await commandOutput([
      process.execPath,
      resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      resolve(project, "tsconfig.json"),
    ], project);
    if (result.exitCode !== 0) throw new Error(`Generated template did not typecheck:\n${result.output}`);
    expect(result.exitCode).toBe(0);
  });

  test("exports declarative RPC, HTTP, and WebSocket handlers", async () => {
    const project = await generatedProject();
    const module = await import(`${pathToFileURL(resolve(project, "src/server.ts")).href}?test=${crypto.randomUUID()}`) as {
      default: DefinedFIAApplication;
    };
    expect(isFIAApplication(module.default)).toBe(true);

    const greet = module.default.backend?.methods.greet;
    if (typeof greet !== "function") throw new Error("Template backend method is not a handler");
    const emitted: unknown[] = [];
    const greeting = await greet({ name: "FIA" }, {
      dataDirectory: "/tmp/fia",
      requestID: "template-rpc-1",
      signal: new AbortController().signal,
      emit: async (name, payload) => { emitted.push({ name, payload }); },
    });
    expect(greeting).toMatchObject({ message: "Hello, FIA!" });
    expect(emitted).toEqual([{ name: "greet.completed", payload: { name: "FIA" } }]);

    const health = module.default.routes?.["/api/health"];
    if (typeof health !== "function") throw new Error("Template HTTP route is not a handler");
    const response = await health(
      new Request("http://127.0.0.1/api/health") as Bun.BunRequest<string>,
      {} as Bun.Server<undefined>,
    );
    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).json()).toEqual({ application: "template-app", status: "ok" });

    const sent: string[] = [];
    module.default.websocket?.message({
      send: (value: string) => {
        sent.push(value);
        return value.length;
      },
    } as Bun.ServerWebSocket<undefined>, JSON.stringify({ id: "template-1", message: "hello" }));
    expect(JSON.parse(sent[0]!)).toEqual({ id: "template-1", echo: "hello" });
  });
});
