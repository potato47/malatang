import { request as httpRequest } from "node:http";
import { nativeCookie, exchangeBrowser } from "./browser-helpers.ts";
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
async function fixture(development = false) {
  const directory = await mkdtemp(resolve(tmpdir(), "fia-gateway-"));
  await mkdir(resolve(directory, "web"));
  await mkdir(resolve(directory, "resources"));
  await writeFile(resolve(directory, "web/index.html"), "<main>FIA</main>");
  const secret = "s".repeat(64);
  const init: InitializeFrame = {
    v: 5,
    type: "initialize",
    sessionSecret: secret,
    preferredPort: 0,
    generation: "generation-1",
    development,
    ...(development ? { developmentOrigin: "http://127.0.0.1:5173" } : {}),
    webRoot: resolve(directory, "web"),
    resourceDirectory: resolve(directory, "resources"),
    applicationSupport: directory,
    version: "1.0.0",
    build: 1,
    app: { name: "Test", identifier: "com.example.test" },
  };
  const listeners = new Map<string, (value: unknown) => void>();
  const calls: string[] = [];
  const timeouts: (number | undefined)[] = [];
  let aborted = false;
  const native = {
    call: async (
      method: string,
      params: unknown,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ) => {
      calls.push(method);
      timeouts.push(options?.timeoutMs);
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
      callbacks: {
        "/oauth/callback": (req) =>
          new Response(
            new URL(req.url).searchParams.get("state") === "expected" ? "accepted" : "invalid",
            { status: new URL(req.url).searchParams.get("state") === "expected" ? 200 : 400 },
          ),
      },
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
  gateway.origin = origin;
  const cookie = await nativeCookie(origin, init);
  const headers = { cookie, origin };
  cleanup.push(async () => {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    server,
    gateway,
    origin,
    init,
    cookie,
    headers,
    directory,
    listeners,
    calls,
    timeouts,
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

test("native gateway lets keychain and file dialogs wait without removing ordinary request deadlines", async () => {
  const f = await fixture();
  const ws = await socket(f.origin.replace("http:", "ws:") + "/_fia/native", f.headers);
  try {
    for (const [id, method] of [
      "keychain.get",
      "keychain.set",
      "keychain.delete",
      "dialogs.openFiles",
      "dialogs.saveFile",
      "clipboard.readText",
    ].entries()) {
      const response = next(ws);
      ws.send(JSON.stringify({ v: 1, type: "request", id: id + 1, method, params: {} }));
      await response;
    }
    expect(f.timeouts).toEqual([0, 0, 0, 0, 0, 30_000]);
  } finally {
    ws.close();
  }
});

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

test("external callbacks are exact GET routes without granting an application session", async () => {
  const f = await fixture();
  const url = f.origin + "/api/oauth/callback?state=expected";
  const accepted = await fetch(url, { headers: { "sec-fetch-site": "cross-site" } });
  expect(accepted.status).toBe(200);
  expect(await accepted.text()).toBe("accepted");
  expect(accepted.headers.get("set-cookie")).toBeNull();
  expect(accepted.headers.get("cache-control")).toBe("no-store");
  expect(accepted.headers.get("referrer-policy")).toBe("no-referrer");
  expect(accepted.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect((await fetch(f.origin + "/api/oauth/callback?state=wrong")).status).toBe(400);
  expect((await fetch(url, { method: "POST" })).status).toBe(405);
  expect(
    (await f.gateway.fetch(new Request(url, { headers: { upgrade: "websocket" } }), f.server))
      ?.status,
  ).toBe(400);
  expect((await fetch(f.origin + "/api/oauth/callback/extra")).status).toBe(401);
  expect((await fetch(f.origin + "/api/hello/FIA")).status).toBe(401);
  expect((await fetch(f.origin + "/_fia/health")).status).toBe(401);
  expect(
    (
      await f.gateway.fetch(
        new Request(
          "http://attacker.example:" + f.server.port + "/api/oauth/callback?state=expected",
        ),
        f.server,
      )
    )?.status,
  ).toBe(403);
  expect(
    (
      await f.gateway.fetch(
        new Request("http://127.0.0.1:5173/api/oauth/callback?state=expected"),
        f.server,
      )
    )?.status,
  ).toBe(403);
  for (const path of [
    "/oauth/*",
    "/oauth/:id",
    "/_fia/token",
    "/oauth/../callback",
    "/oauth?state=x",
  ]) {
    expect(() =>
      createGateway(
        defineBackend({ http: { callbacks: { [path]: () => new Response("no") } } }),
        {
          native: { on: () => () => {} } as unknown as BackendNativeClient,
          app: { ...f.init.app, dataDirectory: f.directory, codeDirectory: f.directory },
        },
        f.init,
      ),
    ).toThrow("exact path");
  }
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

test("browser tickets work in production and development, expire and cannot mark native readiness", async () => {
  for (const development of [false, true]) {
    const f = await fixture(development);
    const issued = f.gateway.issueBrowserURL("/page?q=one");
    expect(new URL(issued).search).toBe("");
    const first = await exchangeBrowser(f.origin, issued);
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBeNull();
    const session = await first.json();
    expect(session.route).toContain("/page?q=one");
    expect(session.token).not.toBe(f.init.sessionSecret);
    expect((await exchangeBrowser(f.origin, issued)).status).toBe(403);
    const headers = { authorization: "Bearer " + session.token, origin: new URL(issued).origin };
    expect((await fetch(f.origin + "/api/hello/browser", { headers })).status).toBe(200);
    for (const browser of [true, false, undefined]) {
      const ready = await fetch(f.origin + "/_fia/ready", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ browser, windowId: "main", generation: f.init.generation }),
      });
      expect(ready.status).toBe(200);
    }
    expect(f.calls).not.toContain("runtime.frontendReady");
    const old = await fetch(f.origin + "/_fia/ready", {
      method: "POST",
      headers,
      body: JSON.stringify({ generation: "old" }),
    });
    expect(old.status).toBe(409);
    const second = f.gateway.issueBrowserURL();
    const originalNow = Date.now;
    try {
      const now = Date.now();
      Date.now = () => now + 60_001;
      expect((await exchangeBrowser(f.origin, second)).status).toBe(403);
    } finally {
      Date.now = originalNow;
    }
    const other = await fixture(development);
    expect((await exchangeBrowser(other.origin, f.gateway.issueBrowserURL())).status).toBe(403);
    f.gateway.revokeBrowsers();
    expect((await fetch(f.origin + "/api/hello/browser", { headers })).status).toBe(401);
  }
});

test("browser and native credentials cannot access host controls or bypass origin checks", async () => {
  const f = await fixture();
  const { token } = await (await exchangeBrowser(f.origin, f.gateway.issueBrowserURL())).json();
  const headers = { authorization: "Bearer " + token, origin: f.origin };
  for (const route of [
    "/api/hello/x",
    "/_fia/health",
    "/_fia/resources/12345678-1234-1234-1234-123456789abc",
  ]) {
    expect((await fetch(f.origin + route)).status).toBe(401);
    expect(
      (await fetch(f.origin + route, { headers: { origin: f.origin, "user-agent": "Safari" } }))
        .status,
    ).toBe(401);
    expect(
      (
        await fetch(f.origin + route, {
          headers: {
            cookie: "fia_" + f.init.sessionSecret.slice(0, 12) + "=" + f.init.sessionSecret,
          },
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(f.origin + route, { headers: { ...headers, origin: "http://127.0.0.1:1" } }))
        .status,
    ).toBe(401);
    expect(
      (await fetch(f.origin + route, { headers: { ...headers, "sec-fetch-site": "cross-site" } }))
        .status,
    ).toBe(401);
    const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        f.origin + route,
        { headers: { ...headers, host: "attacker.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(forgedHost).toBe(403);
    expect(
      (
        await fetch(f.origin + route, {
          headers: { cookie: f.cookie, authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
  }
  for (const credential of [headers, f.headers]) {
    for (const route of ["/_fia/browser/issue", "/_fia/browser/revoke", "/_fia/update/prepare"]) {
      expect(
        (await fetch(f.origin + route, { method: "POST", headers: credential, body: "{}" })).status,
      ).toBe(403);
    }
  }
  expect(f.cookie).not.toContain(f.init.sessionSecret);
  for (const route of [
    "https://attacker.example",
    "//attacker.example",
    "/%2fexample",
    "/x/../api",
    "/api/x",
    "/_fia/health",
  ])
    expect(() => f.gateway.issueBrowserURL(route)).toThrow();
  expect(
    (
      await fetch(f.origin + "/_fia/browser/exchange", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
        body: "{}",
      })
    ).status,
  ).toBe(403);
});

test("browser socket tickets are path-bound and one-use; permissions and revocation cover all streams", async () => {
  const f = await fixture();
  const { token } = await (await exchangeBrowser(f.origin, f.gateway.issueBrowserURL())).json();
  const headers = {
    authorization: "Bearer " + token,
    origin: f.origin,
    "content-type": "application/json",
  };
  const ticket = async (path: string) => {
    const response = await fetch(f.origin + "/_fia/browser/socket", {
      method: "POST",
      headers,
      body: JSON.stringify({ path }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).url as string;
  };
  const issued = await ticket("/_fia/native");
  const ws = await socket(issued, { origin: f.origin });
  for (const [index, method] of [
    "keychain.get",
    "agent.installCLI",
    "application.quit",
    "screen.captureRegion",
    "globalShortcuts.set",
    "runtime.browserRoute",
    "unknown",
  ].entries()) {
    const reply = next(ws);
    ws.send(JSON.stringify({ v: 1, type: "request", id: index + 1, method, params: {} }));
    expect(JSON.parse(await reply).error).toBeDefined();
    expect(f.calls).not.toContain(method);
  }
  const allowed = next(ws);
  ws.send(
    JSON.stringify({ v: 1, type: "request", id: 100, method: "clipboard.readText", params: {} }),
  );
  expect(JSON.parse(await allowed).error).toBeUndefined();
  expect(f.calls).toContain("clipboard.readText");
  await expect(socket(issued, { origin: f.origin })).rejects.toBeDefined();
  const wrongPath = new URL(await ticket("/_fia/native"));
  wrongPath.pathname = "/api/socket";
  await expect(socket(wrongPath.href, { origin: f.origin })).rejects.toBeDefined();
  const business = await socket(await ticket("/api/socket"), { origin: f.origin });
  const echoed = next(business);
  business.send("browser business socket");
  expect(await echoed).toBe("browser business socket");
  const stream = await fetch(f.origin + "/api/stream", { headers });
  const reader = stream.body!.getReader();
  await reader.read();
  const closed = Promise.all(
    [ws, business].map(
      (socket) =>
        new Promise<number>((resolve) => {
          socket.onclose = (event) => resolve(event.code);
        }),
    ),
  );
  const reading = reader.read().catch(() => ({ done: true }));
  f.gateway.revokeBrowsers();
  expect(await closed).toEqual([4001, 4001]);
  expect((await reading).done).toBe(true);
  expect(f.aborted()).toBe(true);
  expect((await fetch(f.origin + "/api/hello/x", { headers })).status).toBe(401);
});
