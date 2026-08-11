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

async function readDevelopmentSessionURL(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) throw new Error("Backend exited before printing a development session URL");
      text += decoder.decode(item.value, { stream: true });
      const match = text.match(
        /FIA_DEV_SESSION_URL=(http:\/\/127\.0\.0\.1:\d+\/_fia\/bootstrap\?code=[^\s]+)/,
      );
      if (match?.[1] !== undefined) return match[1];
    }
  } finally {
    void reader.cancel();
    reader.releaseLock();
  }
}

describe("resident Bun backend runtime", () => {
  test("marks only defineBackend definitions", () => {
    const backend = defineBackend()({ http: { fetch: () => new Response("ok") } });
    expect(isDefinedBackend(backend)).toBe(true);
    expect(isDefinedBackend({ http: {} })).toBe(false);
    expect(() => defineBackend()({} as never)).toThrow("http definition");
    const legacyDefineBackend = defineBackend as unknown as (definition: unknown) => unknown;
    expect(() => legacyDefineBackend({ http: {} })).toThrow("defineBackend now uses");
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
        await runBackend(defineBackend()({ http: {} }));
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
        v: 2,
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

  test("scopes Host event listeners to the active Backend definition", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-backend-events-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      runner,
      `
        import { defineBackend, runBackend } from ${JSON.stringify(backendSource)};
        const backend = (label) => defineBackend()({
          http: {},
          start({ host }) {
            host.statusItem.onClick(() => process.stderr.write(label + "\\n"));
          },
        });
        await runBackend(backend("stale"));
        await Bun.sleep(50);
        await runBackend(backend("active"));
      `,
    );
    const child = Bun.spawn([process.execPath, "--hot", "--no-clear-screen", runner], {
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
        v: 2,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: true,
        applicationSupport: root,
        app: { name: "Events", identifier: "com.example.events" },
      })}\n`,
    );
    input.flush();
    const reader = child.stdout.getReader();
    const ready = await Promise.race([reader.read(), Bun.sleep(5_000).then(() => undefined)]);
    if (ready === undefined || ready.done) {
      if (child.exitCode === null) child.kill("SIGKILL");
      throw new Error("Backend did not become ready");
    }
    expect(new TextDecoder().decode(ready.value)).toContain('"type":"ready"');
    await Bun.sleep(150);
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "event",
        event: "statusItem.clicked",
        payload: { button: "left" },
      })}\n`,
    );
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    const exitCode = await Promise.race([child.exited, Bun.sleep(5_000).then(() => undefined)]);
    if (exitCode === undefined) child.kill("SIGKILL");
    const diagnostic = await stderrText;
    if (exitCode !== 0) throw new Error(`Backend exited with status ${exitCode}: ${diagnostic}`);
    expect(diagnostic).toBe("active\n");
    reader.releaseLock();
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
        let activeContext;
        export default defineBackend()({
          http: {
            publicRoutes: { "/": new Response("page") },
            routes: {
              "/api": {
                GET: (_request, _server, { host, app }) => Response.json({
                  ok: true,
                  app,
                  sameHost: host === activeContext.host,
                  sameApp: app === activeContext.app,
                }),
              },
            },
            fetch: (_request, _server, { host, app }) => Response.json({
              fallback: true,
              sameHost: host === activeContext.host,
              sameApp: app === activeContext.app,
            }),
          },
          async start(context) {
            activeContext = context;
            const { host, url } = context;
            await host.webviews.open({ id: "main", url: url("/").href });
          },
          stop(context) {
            if (context !== activeContext) throw new Error("stop received a different context");
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
      env: { ...process.env, FIA_INTERNAL_PRINT_SESSION_URL: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [markerStream, diagnosticStream] = child.stderr.tee();
    const stderrText = new Response(diagnosticStream).text();
    const printedSessionURL = readDevelopmentSessionURL(markerStream);
    const input = child.stdin;
    if (input === undefined || typeof input === "number") throw new Error("missing child stdin");
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: true,
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
              v: 2,
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
    const sessionURL = await printedSessionURL;
    expect(new URL(sessionURL).origin).toBe(origin);
    const unauthorized = await fetch(`${origin}/api`);
    expect(unauthorized.status).toBe(401);
    const wrongHostBootstrap = await fetch(bootstrapURL!, {
      redirect: "manual",
      headers: { host: `localhost:${new URL(origin).port}` },
    });
    expect(wrongHostBootstrap.status).toBe(401);
    const bootstrap = await fetch(sessionURL, { redirect: "manual" });
    expect(bootstrap.status).toBe(302);
    expect(bootstrap.headers.get("location")).toBe("/");
    expect(bootstrap.headers.get("set-cookie")).toContain("HttpOnly");
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    const authorized = await fetch(`${origin}/api`, { headers: { cookie } });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({
      ok: true,
      app: {
        name: "Test",
        identifier: "com.example.test",
        dataDirectory: root,
      },
      sameHost: true,
      sameApp: true,
    });
    const fallback = await fetch(`${origin}/fallback`, { headers: { cookie } });
    expect(await fallback.json()).toEqual({ fallback: true, sameHost: true, sameApp: true });
    const crossOrigin = await fetch(`${origin}/api`, {
      headers: { cookie, origin: "https://evil.example" },
    });
    expect(crossOrigin.status).toBe(401);
    const wrongHost = await fetch(`${origin}/api`, {
      headers: { cookie, host: `localhost:${new URL(origin).port}` },
    });
    expect(wrongHost.status).toBe(401);
    expect((await fetch(sessionURL, { redirect: "manual" })).status).toBe(403);
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    reader.releaseLock();
    input.end();
  });

  test("expires unconsumed development session URLs after 30 seconds", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-backend-session-expiry-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      runner,
      `
        import { defineBackend, runBackend } from ${JSON.stringify(backendSource)};
        let now = Date.now();
        Date.now = () => now;
        await runBackend(defineBackend()({
          http: { publicRoutes: { "/": new Response("page") } },
          start({ host }) {
            host.statusItem.onClick(() => {
              now += 30_001;
              void host.statusItem.setTooltip("clock advanced");
            });
          },
        }));
      `,
    );
    const child = Bun.spawn([process.execPath, runner], {
      cwd: root,
      env: { ...process.env, FIA_INTERNAL_PRINT_SESSION_URL: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const input = child.stdin;
    if (input === undefined || typeof input === "number") throw new Error("missing child stdin");
    const [markerStream, diagnosticStream] = child.stderr.tee();
    const diagnostic = new Response(diagnosticStream).text();
    const sessionURL = readDevelopmentSessionURL(markerStream);
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: true,
        applicationSupport: root,
        app: { name: "Expiry", identifier: "com.example.expiry" },
      })}\n`,
    );
    input.flush();
    const reader = child.stdout.getReader();
    const first = await Promise.race([reader.read(), Bun.sleep(5_000).then(() => undefined)]);
    if (first === undefined || first.done) {
      if (child.exitCode === null) child.kill("SIGKILL");
      throw new Error(`Backend did not become ready: ${await diagnostic}`);
    }
    expect(new TextDecoder().decode(first.value)).toContain('"type":"ready"');
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "event",
        event: "statusItem.clicked",
        payload: { button: "left" },
      })}\n`,
    );
    input.flush();
    const advanced = await Promise.race([reader.read(), Bun.sleep(5_000).then(() => undefined)]);
    if (advanced === undefined || advanced.done)
      throw new Error("Clock advance event was not handled");
    const request = JSON.parse(new TextDecoder().decode(advanced.value)) as {
      type?: string;
      id?: number;
      method?: string;
    };
    expect(request).toMatchObject({ type: "request", method: "statusItem.setTooltip" });
    input.write(`${JSON.stringify({ v: 2, type: "response", id: request.id, result: null })}\n`);
    input.flush();
    expect(await fetch(await sessionURL, { redirect: "manual" })).toHaveProperty("status", 403);
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    reader.releaseLock();
    input.end();
  });

  test("maps native capability APIs and notification click events", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-native-api-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      runner,
      `
        import { defineBackend, runBackend } from ${JSON.stringify(backendSource)};
        await runBackend(defineBackend()({
          http: {},
          async start({ host }) {
            host.notifications.onClick(({ id }) => process.stderr.write(id + "\\n"));
            await host.notifications.getAuthorizationStatus();
            await host.notifications.requestAuthorization();
            await host.notifications.send({ id: "done", title: "Complete", sound: true });
            await host.dialogs.openFile({ allowedExtensions: ["json"], multiple: true });
            await host.clipboard.writeText("hello");
            await host.clipboard.readText();
            await host.keychain.set("token", "secret");
            await host.keychain.get("token");
            await host.keychain.delete("token");
          },
        }));
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
    const stderr = new Response(child.stderr).text();
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: false,
        applicationSupport: root,
        app: { name: "Native", identifier: "com.example.native" },
      })}\n`,
    );
    input.flush();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const methods: string[] = [];
    while (true) {
      const item = await reader.read();
      if (item.done) throw new Error("Backend exited before ready");
      buffer += decoder.decode(item.value, { stream: true });
      let ready = false;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, newline)) as {
          type: string;
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
        };
        buffer = buffer.slice(newline + 1);
        if (frame.type === "ready") {
          ready = true;
          break;
        }
        if (frame.type !== "request" || frame.id === undefined || frame.method === undefined) {
          throw new Error(`unexpected frame: ${JSON.stringify(frame)}`);
        }
        methods.push(frame.method);
        const result =
          frame.method === "notifications.getAuthorizationStatus" ||
          frame.method === "notifications.requestAuthorization"
            ? "authorized"
            : frame.method === "notifications.send"
              ? { id: frame.params?.id }
              : frame.method === "dialogs.openFile"
                ? ["/tmp/input.json"]
                : frame.method === "clipboard.readText" || frame.method === "keychain.get"
                  ? "secret"
                  : frame.method === "keychain.delete"
                    ? true
                    : null;
        input.write(`${JSON.stringify({ v: 2, type: "response", id: frame.id, result })}\n`);
        input.flush();
      }
      if (ready) break;
    }
    expect(methods).toEqual([
      "notifications.getAuthorizationStatus",
      "notifications.requestAuthorization",
      "notifications.send",
      "dialogs.openFile",
      "clipboard.writeText",
      "clipboard.readText",
      "keychain.set",
      "keychain.get",
      "keychain.delete",
    ]);
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "event",
        event: "notifications.clicked",
        payload: { id: "done" },
      })}\n`,
    );
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    expect(await stderr).toBe("done\n");
    reader.releaseLock();
    input.end();
  });

  test("cancels an interactive Host request with AbortSignal", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-native-cancel-"));
    temporaryDirectories.push(root);
    const backendSource = pathToFileURL(resolve(import.meta.dir, "../src/backend.ts")).href;
    const runner = resolve(root, "runner.ts");
    await Bun.write(
      runner,
      `
        import { defineBackend, runBackend } from ${JSON.stringify(backendSource)};
        await runBackend(defineBackend()({
          http: {},
          async start({ host }) {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 20);
            try {
              await host.dialogs.openFile({}, { signal: controller.signal });
            } catch (error) {
              process.stderr.write(error.name + "\\n");
            }
          },
        }));
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
    const stderr = new Response(child.stderr).text();
    input.write(
      `${JSON.stringify({
        v: 2,
        type: "initialize",
        sessionSecret: crypto.randomUUID() + crypto.randomUUID(),
        preferredPort: 0,
        development: false,
        applicationSupport: root,
        app: { name: "Cancel", identifier: "com.example.cancel" },
      })}\n`,
    );
    input.flush();
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let requestID: number | undefined;
    let sawCancel = false;
    let sawReady = false;
    while (!sawReady) {
      const item = await reader.read();
      if (item.done) throw new Error("Backend exited before ready");
      buffer += decoder.decode(item.value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, newline)) as {
          type: string;
          id?: number;
          method?: string;
        };
        buffer = buffer.slice(newline + 1);
        if (frame.type === "request") {
          requestID = frame.id;
          expect(frame.method).toBe("dialogs.openFile");
        } else if (frame.type === "cancel") {
          expect(frame.id).toBe(requestID);
          sawCancel = true;
          input.write(
            `${JSON.stringify({
              v: 2,
              type: "response",
              id: frame.id,
              error: { code: "CANCELLED", message: "Host request was cancelled" },
            })}\n`,
          );
          input.flush();
        } else if (frame.type === "ready") {
          sawReady = true;
        }
      }
    }
    expect(sawCancel).toBe(true);
    input.write(`${JSON.stringify({ v: 2, type: "event", event: "host.shutdown" })}\n`);
    input.flush();
    expect(await child.exited).toBe(0);
    expect(await stderr).toBe("AbortError\n");
    reader.releaseLock();
    input.end();
  });
});
