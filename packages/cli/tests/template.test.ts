import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject } from "../src/create.ts";

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
  await mkdir(resolve(modules, "@fia"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(packageRoot, resolve(modules, "@fia/cli"), "dir");
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

async function serverOrigin(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let timeoutID: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => reject(new Error(`Template server did not become ready: ${output}`)), 5_000);
  });
  const read = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) throw new Error(`Template server exited before becoming ready: ${output}`);
      output += decoder.decode(result.value, { stream: true });
      const match = output.match(/Listening on (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match?.[1] !== undefined) {
        reader.releaseLock();
        return match[1];
      }
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timeoutID !== undefined) clearTimeout(timeoutID);
  }
}

async function websocketEcho(origin: string): Promise<Record<string, unknown>> {
  const url = new URL("/ws", origin);
  url.protocol = "ws:";
  return await new Promise((resolvePromise, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Template WebSocket timed out"));
    }, 3_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: "template-1", message: "hello" }));
    });
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      const response = JSON.parse(String(event.data)) as Record<string, unknown>;
      socket.close();
      resolvePromise(response);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Template WebSocket failed"));
    });
  });
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

  test("serves the React page, HTTP Hello, and WebSocket Echo", async () => {
    const project = await generatedProject();
    const child = Bun.spawn([process.execPath, "src/server.ts"], {
      cwd: project,
      env: { ...process.env, PORT: "0", NO_COLOR: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      let origin: string;
      try {
        origin = await serverOrigin(child.stdout);
      } catch (error) {
        const stderr = await new Response(child.stderr).text();
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
      }
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root"></div>');

      const hello = await fetch(new URL("/api/hello", origin));
      expect(hello.status).toBe(200);
      expect(await hello.json()).toMatchObject({ message: "Hello from template-app" });
      expect(await websocketEcho(origin)).toEqual({ id: "template-1", echo: "hello" });
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
    expect(await child.exited).not.toBe(0);
  });
});
