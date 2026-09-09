import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createGateway } from "../src/gateway.ts";
import { defineBackend, type BackendNativeClient, type InitializeFrame } from "../src/backend.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-gateway-"));
  await mkdir(resolve(directory, "web"));
  await mkdir(resolve(directory, "resources"));
  await writeFile(resolve(directory, "web/index.html"), "<main>FIA</main>");
  const secret = "s".repeat(64);
  const init: InitializeFrame = {
    v: 4,
    type: "initialize",
    sessionSecret: secret,
    preferredPort: 0,
    generation: "generation-1",
    development: false,
    webRoot: resolve(directory, "web"),
    resourceDirectory: resolve(directory, "resources"),
    applicationSupport: directory,
    version: "1.0.0",
    build: 1,
    app: { name: "Test", identifier: "com.example.test" },
  };
  const listeners = new Map<string, (value: unknown) => void>();
  const calls: string[] = [];
  let aborted = false;
  const native = {
    call: async (method: string, params: unknown, options?: { signal?: AbortSignal }) => {
      calls.push(method);
      if (method === "resources.resolve")
        return {
          path: resolve(directory, "resources/12345678-1234-1234-1234-123456789abc"),
          contentType: "application/octet-stream",
        };
      if (method === "wait")
        return await new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          }),
        );
      return params;
    },
    on: (event: string, listener: (value: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  } as unknown as BackendNativeClient;
  const backend = defineBackend({
    http: {
      routes: { "/hello/:name": (req) => Response.json({ name: req.params.name }) },
      fetch: (req, server) => {
        if (
          new URL(req.url).pathname === "/socket" &&
          server.upgrade(req, { data: { business: true } })
        )
          return;
        if (new URL(req.url).pathname === "/stream")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: first\n\n"));
                const timer = setTimeout(() => {
                  controller.enqueue(new TextEncoder().encode("data: second\n\n"));
                  controller.close();
                }, 31_000);
                req.signal.addEventListener("abort", () => {
                  clearTimeout(timer);
                  aborted = true;
                  try {
                    controller.close();
                  } catch {}
                });
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        return new Response("missing", { status: 404 });
      },
      websocket: {
        message: (socket, message) => {
          socket.send(message);
        },
      },
    },
  });
  const gateway = createGateway(
    backend,
    { native, app: { ...init.app, dataDirectory: directory, codeDirectory: directory } },
    init,
  );
  gateway.ready = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: gateway.fetch,
    websocket: gateway.websocket,
  });
  const origin = "http://127.0.0.1:" + server.port;
  const cookie = "fia_" + secret.slice(0, 12) + "=" + secret;
  const headers = { cookie, origin };
  cleanup.push(async () => {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    server,
    origin,
    init,
    cookie,
    headers,
    directory,
    listeners,
    calls,
    aborted: () => aborted,
  };
}
async function socket(url: string, headers: Record<string, string>) {
  const ws = new WebSocket(url, { headers } as never);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = reject;
  });
  return ws;
}
function next(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.onmessage = (event) => resolve(String(event.data));
    ws.onerror = reject;
  });
}

test("one-time bootstrap, scoped authentication and real HTTP routes", async () => {
  const f = await fixture();
  expect((await fetch(f.origin)).status).toBe(200);
  expect((await fetch(f.origin + "/api/hello/FIA")).status).toBe(401);
  const query = new URLSearchParams({
    window: "main",
    route: "/",
    nonce: "nonce-1",
    proof: createHmac("sha256", f.init.sessionSecret)
      .update(["main", "/", "nonce-1", f.init.generation].join("\n"))
      .digest("hex"),
  });
  const bootstrap = f.origin + "/_fia/bootstrap?" + query;
  const first = await fetch(bootstrap, { redirect: "manual" });
  expect(first.status).toBe(302);
  expect(first.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
  expect((await fetch(bootstrap, { redirect: "manual" })).status).toBe(403);
  expect(await (await fetch(f.origin + "/api/hello/FIA", { headers: f.headers })).json()).toEqual({
    name: "FIA",
  });
  expect(
    (
      await fetch(f.origin + "/api/hello/FIA", {
        headers: { ...f.headers, origin: "https://attacker.example" },
      })
    ).status,
  ).toBe(401);
});

test("native and business WebSockets coexist, support cancellation and native events", async () => {
  const f = await fixture();
  const ws = await socket(f.origin.replace("http:", "ws:") + "/_fia/native", f.headers);
  let reply = next(ws);
  ws.send(JSON.stringify({ v: 1, type: "request", id: 1, method: "echo", params: [true, null] }));
  expect(JSON.parse(await reply).result).toEqual([true, null]);
  reply = next(ws);
  f.listeners.get("windows.titlebarAction")?.({ windowId: "main", itemId: "copy" });
  expect(JSON.parse(await reply).event).toBe("windows.titlebarAction");
  reply = next(ws);
  ws.send(JSON.stringify({ v: 1, type: "request", id: 2, method: "wait", params: {} }));
  await Bun.sleep(20);
  ws.send(JSON.stringify({ v: 1, type: "cancel", id: 2 }));
  expect(JSON.parse(await reply).error).toBeDefined();
  expect(f.aborted()).toBe(true);
  reply = next(ws);
  ws.send(
    JSON.stringify({ v: 1, type: "request", id: 3, method: "resources.resolve", params: {} }),
  );
  expect(JSON.parse(await reply).error).toBeDefined();
  expect(f.calls).not.toContain("resources.resolve");
  const business = await socket(f.origin.replace("http:", "ws:") + "/api/socket", f.headers);
  const echoed = next(business);
  business.send("standard websocket");
  expect(await echoed).toBe("standard websocket");
  business.close();
  ws.close();
});

test("native resource delivery and static routes cannot escape their roots", async () => {
  const f = await fixture();
  const id = "12345678-1234-1234-1234-123456789abc";
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(42);
  await writeFile(resolve(f.directory, "resources", id), bytes);
  expect(
    (await (await fetch(f.origin + "/_fia/resources/" + id, { headers: f.headers })).arrayBuffer())
      .byteLength,
  ).toBe(bytes.byteLength);
  await writeFile(resolve(f.directory, "secret.txt"), "secret");
  await symlink(resolve(f.directory, "secret.txt"), resolve(f.directory, "web/leak.txt"));
  expect((await fetch(f.origin + "/leak.txt")).status).toBe(404);
  expect(
    (
      await fetch(f.origin + "/_fia/ready", {
        method: "POST",
        headers: { ...f.headers, "content-type": "application/json" },
        body: JSON.stringify({ windowId: "main", generation: "old" }),
      })
    ).status,
  ).toBe(409);
});

test("SSE delivers the first chunk immediately and survives more than 30 seconds", async () => {
  const f = await fixture();
  const start = Date.now();
  const response = await fetch(f.origin + "/api/stream", { headers: f.headers });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("first");
  expect(Date.now() - start).toBeLessThan(3000);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("second");
  expect((await reader.read()).done).toBe(true);
}, 35_000);

test("SSE cancellation releases the upstream operation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const response = await fetch(f.origin + "/api/stream", {
    headers: f.headers,
    signal: controller.signal,
  });
  await response.body!.getReader().read();
  controller.abort();
  for (let i = 0; i < 100 && !f.aborted(); i++) await Bun.sleep(10);
  expect(f.aborted()).toBe(true);
});
