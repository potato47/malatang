import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomToken } from "../src/runtime/security.ts";

interface Ready {
  protocol: number;
  type: string;
  port: number;
  pid: number;
}

class JSONLineReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async next<T>(): Promise<T> {
    const timeout = setTimeout(() => void this.reader.cancel("line timeout"), 5_000);
    try {
      while (!this.buffer.includes("\n")) {
        const result = await this.reader.read();
        if (result.done) throw new Error("managed runtime exited before protocol message");
        this.buffer += this.decoder.decode(result.value, { stream: true });
      }
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      return JSON.parse(line) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function cookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("bootstrap did not set a session cookie");
  return header.split(";", 1)[0]!;
}

async function websocketMessage(
  url: string,
  origin: string,
  session: string,
  message: string,
  protocols?: string[],
): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const BunWebSocket = WebSocket as unknown as {
      new(url: string, options: Bun.WebSocketOptions): WebSocket;
    };
    const socket = new BunWebSocket(url, {
      protocols,
      headers: { Cookie: session, Origin: origin },
    });
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket request timed out"));
    }, 3_000);
    socket.addEventListener("open", () => socket.send(message));
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      socket.close();
      resolvePromise(String(event.data));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket request failed"));
    });
  });
}

describe("managed FIA runtime", () => {
  test("uses the Host protocol and protects production UI and application routes", async () => {
    const dataDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "fia-managed-runtime-")));
    const bootstrapToken = randomToken();
    const controlToken = randomToken();
    const child = Bun.spawn([
      process.execPath,
      resolve(import.meta.dir, "fixtures/managed-production.ts"),
    ], {
      cwd: dataDirectory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = new JSONLineReader(child.stdout);
    const stderr = new Response(child.stderr).text();
    try {
      child.stdin.write(`${JSON.stringify({
        protocol: 1,
        type: "initialize",
        bootstrapToken,
        controlToken,
        parentPid: process.pid,
        dataDirectory,
      })}\n`);
      child.stdin.flush();
      let ready: Ready;
      try {
        ready = await output.next<Ready>();
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : error}\n${await stderr}`);
      }
      expect(ready).toMatchObject({ protocol: 1, type: "ready", pid: child.pid });
      const origin = `http://127.0.0.1:${ready.port}`;

      expect((await fetch(`${origin}/api/test`)).status).toBe(401);
      const health = await fetch(`${origin}/__fia/health`, {
        headers: { Authorization: `Bearer ${controlToken}` },
      });
      expect(await health.json()).toEqual({ protocol: 1, status: "ok", pid: child.pid });

      const bootstrap = await fetch(`${origin}/__fia/bootstrap/${bootstrapToken}`, { redirect: "manual" });
      expect(bootstrap.status).toBe(303);
      const session = cookie(bootstrap);
      const page = await fetch(origin, { headers: { Cookie: session } });
      expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-");
      expect(await page.text()).not.toContain("__FIA_CSP_NONCE__");
      const application = await fetch(`${origin}/api/test`, { headers: { Cookie: session } });
      expect(await application.json()).toEqual({ managed: true });

      child.stdin.write(`${JSON.stringify({
        protocol: 1,
        type: "request",
        id: "rpc-1",
        method: "greet",
        input: { name: "FIA" },
      })}\n`);
      child.stdin.flush();
      expect(await output.next<Record<string, unknown>>()).toEqual({
        protocol: 1,
        type: "event",
        name: "greet.completed",
        payload: { name: "FIA" },
      });
      expect(await output.next<Record<string, unknown>>()).toEqual({
        protocol: 1,
        type: "response",
        id: "rpc-1",
        ok: true,
        value: { message: "Hello, FIA" },
      });
      child.stdin.write(`${JSON.stringify({
        protocol: 1,
        type: "request",
        id: "rpc-cancel",
        method: "hold",
        input: null,
      })}\n`);
      child.stdin.write(`${JSON.stringify({ protocol: 1, type: "cancel", id: "rpc-cancel" })}\n`);
      child.stdin.flush();
      expect(await output.next<Record<string, unknown>>()).toEqual({
        protocol: 1,
        type: "event",
        name: "hold.cancelled",
        payload: { requestID: "rpc-cancel" },
      });
      expect(await websocketMessage(
        `${origin.replace("http:", "ws:")}/ws`,
        origin,
        session,
        "hello",
      )).toBe("application:hello");
      expect(JSON.parse(await websocketMessage(
        `${origin.replace("http:", "ws:")}/__fia/ws`,
        origin,
        session,
        JSON.stringify({
          protocol: 1,
          type: "request",
          id: "managed-ws",
          method: "echo",
          params: { message: "secure" },
        }),
        ["fia.v1"],
      ))).toEqual({
        protocol: 1,
        type: "response",
        id: "managed-ws",
        result: { echo: "secure" },
      });

      child.stdin.write(`${JSON.stringify({ protocol: 1, type: "shutdown", reason: "applicationQuit" })}\n`);
      child.stdin.end();
      expect(await child.exited).toBe(0);
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      throw new Error(`${error instanceof Error ? error.message : error}\n${await stderr}`);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });

  test("hot reloads application routes without changing the runtime PID or session", async () => {
    const dataDirectory = await realpath(await mkdtemp(resolve(tmpdir(), "fia-managed-hmr-")));
    const runtimeAPI = resolve(import.meta.dir, "../src/runtime.ts");
    const managedRuntime = resolve(import.meta.dir, "../src/runtime/managed.ts");
    const applicationPath = resolve(dataDirectory, "application.ts");
    const entryPath = resolve(dataDirectory, "entry.ts");
    const bootstrapToken = randomToken();
    const controlToken = randomToken();
      const applicationSource = (version: number): string => `
      import { defineApp } from ${JSON.stringify(runtimeAPI)};
      export default defineApp({
        backend: { methods: { version: () => ({ version: ${version} }) } },
        routes: { "/api/version": () => Response.json({ version: ${version} }) },
      });
    `;
    await mkdir(resolve(dataDirectory, "ui"));
    await Promise.all([
      writeFile(applicationPath, applicationSource(1)),
      writeFile(resolve(dataDirectory, "ui/index.html"), '<!doctype html><script type="module" src="./main.ts"></script>'),
      writeFile(resolve(dataDirectory, "ui/main.ts"), "document.body.append('HMR');\n"),
      writeFile(entryPath, `
        import application from ${JSON.stringify(applicationPath)};
        import page from "./ui/index.html";
        import { startManagedRuntime } from ${JSON.stringify(managedRuntime)};
        await startManagedRuntime({ mode: "development", application, ui: page });
        if (import.meta.hot) import.meta.hot.accept();
      `),
    ]);
    const child = Bun.spawn([process.execPath, "--hot", "--no-clear-screen", entryPath], {
      cwd: dataDirectory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = new JSONLineReader(child.stdout);
    const stderr = new Response(child.stderr).text();
    try {
      child.stdin.write(`${JSON.stringify({
        protocol: 1,
        type: "initialize",
        bootstrapToken,
        controlToken,
        parentPid: process.pid,
        dataDirectory,
      })}\n`);
      child.stdin.flush();
      const ready = await output.next<Ready>();
      const origin = `http://127.0.0.1:${ready.port}`;
      const bootstrap = await fetch(`${origin}/__fia/bootstrap/${bootstrapToken}`, { redirect: "manual" });
      const session = cookie(bootstrap);
      const version = async (): Promise<number> => {
        const response = await fetch(`${origin}/api/version`, { headers: { Cookie: session } });
        return ((await response.json()) as { version: number }).version;
      };
      expect(await version()).toBe(1);
      const originalPID = ready.pid;
      await writeFile(applicationPath, applicationSource(2));
      const deadline = Date.now() + 5_000;
      while (await version() !== 2) {
        if (Date.now() >= deadline) throw new Error("application route did not hot reload");
        await Bun.sleep(50);
      }
      expect(child.pid).toBe(originalPID);

      child.stdin.write(`${JSON.stringify({ protocol: 1, type: "shutdown", reason: "applicationQuit" })}\n`);
      child.stdin.end();
      expect(await child.exited).toBe(0);
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      throw new Error(`${error instanceof Error ? error.message : error}\n${await stderr}`);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 10_000);
});
