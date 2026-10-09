import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { browserWorker, injectBrowserRuntime } from "../src/browser-assets.ts";

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const requests: Request[] = [];
  const forwarding: RequestInit[] = [];
  const clients = new Map<
    string,
    { id: string; url: string; postMessage: (message: any) => void }
  >();
  const notices: unknown[] = [];
  let status = 200;
  const origin = "http://127.0.0.1:54321";
  runInNewContext(browserWorker, {
    URL,
    Request: class extends Request {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init);
        forwarding.push(init ?? {});
      }
    },
    Response,
    Headers,
    crypto,
    setTimeout,
    clearTimeout,
    self: {
      location: { origin },
      addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
      clients: { get: async (id: string) => clients.get(id) },
    },
    fetch: async (request: Request) => {
      requests.push(request);
      return new Response("asset", { status });
    },
  });
  function page(id: string, token?: string, pageOrigin = origin) {
    const client = {
      id,
      url: pageOrigin + "/?fiaBrowser=1",
      postMessage(message: any) {
        notices.push(message);
        if (message.type === "fia:need-auth" && token)
          handlers.get("message")!({
            source: client,
            data: { type: "fia:auth", nonce: message.nonce, token },
          });
      },
    };
    clients.set(id, client);
    return client;
  }
  function request(path: string, clientId = "one", mode?: string) {
    let result: Promise<Response> | undefined;
    const req = new Request(new URL(path, origin));
    if (mode) Object.defineProperty(req, "mode", { value: mode });
    handlers.get("fetch")!({
      request: req,
      clientId,
      respondWith: (value: Promise<Response>) => {
        result = value;
      },
    });
    return result;
  }
  return {
    handlers,
    requests,
    forwarding,
    page,
    request,
    notices,
    status(value: number) {
      status = value;
    },
  };
}

test("browser worker authenticates scripts, styles and streams only for their own client and origin", async () => {
  const w = worker();
  const token = "a".repeat(64);
  w.page("one", token);
  w.page("two", "b".repeat(64));
  for (const path of ["/api/plugin/page.js", "/api/plugin/style.css", "/_fia/api/events"])
    expect((await w.request(path))?.status).toBe(200);
  expect(w.requests.map((request) => request.headers.get("authorization"))).toEqual(
    Array(3).fill("Bearer " + token),
  );
  expect(
    w.requests.every((request) => request.redirect === "error" && request.cache === "no-store"),
  ).toBe(true);
  expect(w.forwarding.every((init) => init.credentials === "omit" && init.mode === "cors")).toBe(
    true,
  );
  await w.request("/api/second", "two");
  expect(w.requests.at(-1)!.headers.get("authorization")).toBe("Bearer " + "b".repeat(64));
  expect((await w.request("/api/private", "unknown"))?.status).toBe(401);
  for (const path of [
    "http://127.0.0.1:1234/api/private",
    "https://example.com/api/private",
    "/_fia/browser/exchange",
    "/index.html",
  ])
    expect(w.request(path)).toBeUndefined();
  expect(w.request("/api/private", "one", "navigate")).toBeUndefined();
  expect(w.requests).toHaveLength(4);
});

test("worker recovery only consults the requesting tab and rejects a foreign message source", async () => {
  const w = worker();
  const attacker = w.page("one", undefined, "http://127.0.0.1:1234");
  w.handlers.get("message")!({
    source: attacker,
    data: { type: "fia:bind", token: "a".repeat(64) },
    ports: [],
  });
  expect((await w.request("/api/private"))?.status).toBe(401);
  w.page("one", "c".repeat(64));
  await Promise.all([w.request("/api/first"), w.request("/api/second")]);
  expect(w.requests).toHaveLength(2);
  expect(
    w.requests.every(
      (request) => request.headers.get("authorization") === "Bearer " + "c".repeat(64),
    ),
  ).toBe(true);
  expect(w.notices.filter((value: any) => value.type === "fia:need-auth")).toHaveLength(1);
  w.status(401);
  expect((await w.request("/api/private"))?.status).toBe(401);
  expect(w.notices.at(-1)).toEqual({ type: "fia:expired" });
});

test("framework HTML injects its early browser bootstrap exactly once", () => {
  const html =
    '<!doctype html><html><head><script type="module" src="/app.js"></script></head></html>';
  const output = injectBrowserRuntime(html);
  expect(output.indexOf("/_fia/browser/runtime.js")).toBeLessThan(output.indexOf("/app.js"));
  expect(injectBrowserRuntime(output)).toBe(output);
});
