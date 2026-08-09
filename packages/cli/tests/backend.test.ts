import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineBackend, isDefinedBackend } from "../src/backend.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("resident Bun backend runtime", () => {
  test("marks only defineBackend definitions", () => {
    const backend = defineBackend({ http: { fetch: () => new Response("ok") } });
    expect(isDefinedBackend(backend)).toBe(true);
    expect(isDefinedBackend({ http: {} })).toBe(false);
    expect(() => defineBackend({} as never)).toThrow("http definition");
  });

  test("rejects initialize frames with unknown fields", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-backend-protocol-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      runner,
      `
        import { defineBackend, runBackend } from ${JSON.stringify(backendSource)};
        await runBackend(defineBackend({ http: {} }));
      `,
    );
    const child = Bun.spawn([process.execPath, runner], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const input = child.stdin;
    if (input === undefined || typeof input === "number") throw new Error("missing child stdin");
    input.write(
      `${JSON.stringify({
        v: 1,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: false,
        applicationSupport: root,
        app: { name: "Test", identifier: "com.example.test" },
        legacy: true,
      })}\n`,
    );
    input.flush();
    expect(await child.exited).not.toBe(0);
    expect(await new Response(child.stderr).text()).toContain("Invalid initialize frame");
    input.end();
  });

  test("uses one-time bootstrap sessions and protects handlers", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-backend-runtime-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const entry = resolve(root, "entry.ts");
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      entry,
      `
        import { defineBackend } from ${JSON.stringify(backendSource)};
        export default defineBackend({
          http: {
            publicRoutes: { "/": new Response("page") },
            routes: { "/api": { GET: () => Response.json({ ok: true }) } },
          },
          async start({ host, url }) {
            await host.webviews.open({ id: "main", url: url("/").href });
          },
        });
      `,
    );
    await Bun.write(
      runner,
      `
        import backend from ${JSON.stringify(pathToFileURL(entry).href)};
        import { runBackend } from ${JSON.stringify(backendSource)};
        await runBackend(backend);
      `,
    );
    const child = Bun.spawn([process.execPath, runner], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderrText = new Response(child.stderr).text();
    const input = child.stdin;
    if (input === undefined || typeof input === "number") throw new Error("missing child stdin");
    input.write(
      `${JSON.stringify({
        v: 1,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: false,
        applicationSupport: root,
        app: { name: "Test", identifier: "com.example.test" },
      })}\n`,
    );
    input.flush();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bootstrapURL: string | undefined;
    let origin: string | undefined;
    const deadline = Date.now() + 5_000;
    while (origin === undefined && Date.now() < deadline) {
      const item = await reader.read();
      if (item.done) break;
      buffer += decoder.decode(item.value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, newline)) as {
          type: string;
          id?: number;
          method?: string;
          params?: { url?: string };
          origin?: string;
        };
        buffer = buffer.slice(newline + 1);
        if (frame.type === "request") {
          expect(frame.method).toBe("webviews.open");
          bootstrapURL = frame.params?.url;
          input.write(
            `${JSON.stringify({
              v: 1,
              type: "response",
              id: frame.id,
              result: {
                id: "main",
                url: bootstrapURL,
                title: "Test",
                visible: true,
                focused: true,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false,
              },
            })}\n`,
          );
          input.flush();
        } else if (frame.type === "ready") {
          origin = frame.origin;
        }
      }
    }
    if (origin === undefined) {
      input.end();
      if (child.exitCode === null) child.kill("SIGKILL");
      throw new Error(`Backend did not become ready: ${await stderrText}`);
    }
    expect(origin).toStartWith("http://127.0.0.1:");
    expect(bootstrapURL).toContain("/_fia/bootstrap?code=");
    const unauthorized = await fetch(`${origin}/api`);
    expect(unauthorized.status).toBe(401);
    const wrongHostBootstrap = await fetch(bootstrapURL!, {
      redirect: "manual",
      headers: { host: `localhost:${new URL(origin).port}` },
    });
    expect(wrongHostBootstrap.status).toBe(401);
    const bootstrap = await fetch(bootstrapURL!, { redirect: "manual" });
    expect(bootstrap.status).toBe(302);
    expect(bootstrap.headers.get("location")).toBe("/");
    expect(bootstrap.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    const authorized = await fetch(`${origin}/api`, { headers: { cookie } });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true });
    const crossOrigin = await fetch(`${origin}/api`, {
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(crossOrigin.status).toBe(401);
    const wrongHost = await fetch(`${origin}/api`, {
      headers: { cookie, host: `localhost:${new URL(origin).port}` },
    });
    expect(wrongHost.status).toBe(401);
    expect((await fetch(bootstrapURL!, { redirect: "manual" })).status).toBe(403);
    input.write(`${JSON.stringify({ v: 1, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    reader.releaseLock();
    input.end();
  });
});
