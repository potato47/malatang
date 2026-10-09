import { APIServer, apiError } from "./api-server.ts";
import { APIError } from "./api-client.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { BrowserSessions, browserNativeMethods, type BrowserSession } from "./browser-sessions.ts";
import {
  browserBootstrap,
  browserRuntime,
  browserWorker,
  injectBrowserRuntime,
} from "./browser-assets.ts";
import type { BackendDefinition, BackendRouteContext, InitializeFrame } from "./backend.ts";

const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const response = (message: string, status: number) =>
  status === 401 || status === 403
    ? apiError(new APIError(status === 401 ? "unauthorized" : "forbidden", message), status)
    : new Response(message, { status });
const safePath = (path: string) =>
  path.startsWith("/") &&
  !path.startsWith("//") &&
  !/[\\\p{Cc}]/u.test(path) &&
  !path.split("/").some((part) => part === ".." || part === ".");
type Socket = Bun.ServerWebSocket<unknown>;

/** Bun is the only HTTP authority. All native operations leave it over stdio. */
export function createGateway<Data, Paths extends string>(
  input: BackendDefinition<Data, Paths>,
  routeContext: Omit<BackendRouteContext, "emit"> & Partial<Pick<BackendRouteContext, "emit">>,
  init: InitializeFrame,
  api?: APIServer,
  update?: (action: "prepare" | "resume") => Promise<void>,
) {
  const definition = input as unknown as BackendDefinition;
  const context: BackendRouteContext = {
    ...routeContext,
    emit:
      routeContext.emit ??
      api?.emit ??
      (() => {
        throw new APIError("not_found", "No API events are configured");
      }),
  };
  const sessions = new BrowserSessions(init.generation);
  const cookieName = sessions.cookieName;
  const socketSessions = new Map<Socket, BrowserSession>();
  const usedTickets = new Set<string>();
  const nativeSockets = new Map<Socket, Map<number, AbortController>>();
  const callbacks = new Map(Object.entries(definition.http.callbacks ?? {}));
  for (const path of callbacks.keys()) {
    if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path) || path.startsWith("/_fia"))
      throw new Error("Callback routes require an exact path: " + path);
  }
  const rules = Object.entries(definition.http.routes ?? {}).map(([path, handler]) => {
    if (!path.startsWith("/") || path.startsWith("/_fia"))
      throw new Error("Invalid backend route: " + path);
    const names: string[] = [];
    const pattern = path
      .split("/")
      .map((segment) => {
        if (segment === "*") return ".*";
        if (segment.startsWith(":")) {
          names.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { pattern: new RegExp("^" + pattern + "$"), names, handler };
  });
  const validOrigins = (server: Bun.Server<unknown>) => [
    "http://127.0.0.1:" + server.port,
    ...(init.developmentOrigin ? [init.developmentOrigin] : []),
  ];
  function authorized(
    request: Request,
    server: Bun.Server<unknown>,
  ): "internal" | "native" | BrowserSession | undefined {
    const url = new URL(request.url);
    if (!validOrigins(server).includes(url.origin)) return;
    const internal = request.headers.get("x-fia-session");
    if (internal && equal(internal, init.sessionSecret)) return "internal";
    const origin = request.headers.get("origin");
    if (origin && !validOrigins(server).includes(origin)) return;
    if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) return;
    if (url.searchParams.has("fiaSocketTicket")) {
      if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket")
        return;
      const session = sessions.consumeSocket(url, origin);
      if (session) Object.defineProperty(request, "url", { value: url.href, configurable: true });
      return session;
    }
    const bearer = request.headers.get("authorization");
    if (bearer) {
      const session = sessions.get(bearer.startsWith("Bearer ") ? bearer.slice(7) : "");
      return session && (!origin || session.origin === origin) ? session : undefined;
    }
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    return cookie && equal(cookie, sessions.nativeToken) ? "native" : undefined;
  }
  async function json(request: Request): Promise<Record<string, unknown>> {
    // Public exchange and framework controls never accept a large payload.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    let body = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        body += decoder.decode(next.value, { stream: true });
        if (body.length > 4096) throw new Error("Body too large");
      }
      return JSON.parse(body + decoder.decode());
    } finally {
      await reader.cancel();
    }
  }
  const gateway = {
    ready: false,
    origin: "",
    revokeBrowsers() {
      sessions.revoke();
    },
    issueBrowserURL(route = "/"): string {
      if (!gateway.ready || api?.updating)
        throw new APIError("updating", "Application is not ready");
      return sessions.issue(init.developmentOrigin ?? gateway.origin, route);
    },
    async fetch(request: Request, server: Bun.Server<unknown>): Promise<Response | undefined> {
      if (!validOrigins(server).includes(new URL(request.url).origin))
        return response("Invalid host", 403);
      const principal = authorized(request, server);
      const browser = typeof principal === "object" ? principal : undefined;
      if (browser) {
        Object.defineProperty(request, "signal", {
          value: AbortSignal.any([request.signal, browser.controller.signal]),
          configurable: true,
        });
      }
      const wrappedServer = browser
        ? new Proxy(server, {
            get(target, property) {
              if (property === "upgrade")
                return (req: Request, options?: { data?: unknown; headers?: HeadersInit }) =>
                  target.upgrade(req, {
                    ...options,
                    data: { fiaBrowserSession: browser, originalData: options?.data },
                  });
              const value = Reflect.get(target, property, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })
        : server;
      const result = await gateway.dispatch(request, wrappedServer, principal);
      if (!browser || !result?.body) return result;
      if (browser.controller.signal.aborted) {
        await result.body.cancel().catch(() => {});
        return response("Unauthorized", 401);
      }
      const reader = result.body.getReader();
      let remove = () => {};
      let ended = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => {
            if (ended) return;
            ended = true;
            controller.close();
            void reader.cancel().catch(() => {});
            remove();
          };
          browser.controller.signal.addEventListener("abort", abort, { once: true });
          remove = () => browser.controller.signal.removeEventListener("abort", abort);
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (ended) return;
            if (next.done) {
              ended = true;
              remove();
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            if (!ended) {
              ended = true;
              remove();
              controller.error(error);
            }
          }
        },
        async cancel(reason) {
          ended = true;
          remove();
          await reader.cancel(reason);
        },
      });
      return new Response(body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    },
    async dispatch(
      request: Request,
      server: Bun.Server<unknown>,
      principal: "internal" | "native" | BrowserSession | undefined,
    ): Promise<Response | undefined> {
      const url = new URL(request.url);
      const path = url.pathname;
      const browser = typeof principal === "object" ? principal : undefined;
      if (
        ["/_fia/browser/open", "/_fia/browser/runtime.js", "/_fia/browser/worker.js"].includes(path)
      ) {
        if (request.method !== "GET") return response("Method Not Allowed", 405);
        return new Response(
          path.endsWith("worker.js")
            ? browserWorker
            : path.endsWith("runtime.js")
              ? browserRuntime
              : browserBootstrap,
          {
            headers: {
              "content-type": path.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/html; charset=utf-8",
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
              "service-worker-allowed": "/",
              "content-security-policy": "frame-ancestors 'none'; base-uri 'none'",
            },
          },
        );
      }
      if (path === "/_fia/browser/exchange") {
        const origin = request.headers.get("origin");
        if (
          request.method !== "POST" ||
          !origin ||
          !validOrigins(server).includes(origin) ||
          request.headers.get("x-fia-browser-bootstrap") !== "1" ||
          request.headers.get("content-type") !== "application/json" ||
          ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")
        )
          return response("Forbidden", 403);
        if (!gateway.ready || api?.updating) return response("Application is not ready", 503);
        try {
          const input = await json(request);
          return Response.json(
            sessions.exchange(typeof input.ticket === "string" ? input.ticket : "", origin),
            { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } },
          );
        } catch {
          return response("Invalid or expired browser ticket", 403);
        }
      }
      if (path === "/_fia/browser/issue" || path === "/_fia/browser/revoke") {
        if (principal !== "internal" || request.method !== "POST")
          return response("Forbidden", 403);
        try {
          if (path.endsWith("revoke")) {
            sessions.revoke();
            return Response.json({ ok: true });
          }
          const input = await json(request);
          return Response.json(
            { url: gateway.issueBrowserURL(typeof input.route === "string" ? input.route : "/") },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return response("Browser access is not available", 409);
        }
      }
      if (path === "/_fia/bootstrap") {
        const id = url.searchParams.get("window") ?? "";
        const route = url.searchParams.get("route") ?? "/";
        const nonce = url.searchParams.get("nonce") ?? "";
        const proof = url.searchParams.get("proof") ?? "";
        const expected = createHmac("sha256", init.sessionSecret)
          .update([id, route, nonce, init.generation].join("\n"))
          .digest("hex");
        if (
          request.method !== "GET" ||
          !/^[\w-]{1,100}$/u.test(id) ||
          !/^[\w-]{1,100}$/u.test(nonce) ||
          !safePath(route) ||
          usedTickets.has(nonce) ||
          usedTickets.size >= 4096 ||
          !equal(proof, expected)
        )
          return response("Invalid bootstrap ticket", 403);
        usedTickets.add(nonce);
        const target = new URL(route, init.developmentOrigin ?? url.origin);
        target.searchParams.set("fiaWindow", id);
        target.searchParams.set("fiaGeneration", init.generation);
        return new Response(null, {
          status: 302,
          headers: {
            location: target.pathname + target.search,
            "set-cookie":
              cookieName + "=" + sessions.nativeToken + "; HttpOnly; SameSite=Strict; Path=/",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      }
      const callback = path.startsWith("/api/") ? callbacks.get(path.slice(4)) : undefined;
      if (callback) {
        // Only the actual loopback authority, never the Vite proxy or a forged Host.
        if (url.origin !== "http://127.0.0.1:" + server.port)
          return response("Invalid callback host", 403);
        if (request.method !== "GET") return response("Method Not Allowed", 405);
        if (request.headers.has("upgrade")) return response("Invalid callback request", 400);
        const target = new URL(url);
        target.pathname = path.slice(4);
        const forwarded = request as Bun.BunRequest;
        Object.defineProperty(forwarded, "url", { value: target.href, configurable: true });
        Object.defineProperty(forwarded, "params", { value: {}, configurable: true });
        const result = await callback(forwarded, server, context);
        if (!result) return response("Empty callback response", 500);
        const headers = new Headers(result.headers);
        headers.delete("set-cookie");
        headers.set("cache-control", "no-store");
        headers.set("referrer-policy", "no-referrer");
        headers.set("x-content-type-options", "nosniff");
        headers.set(
          "content-security-policy",
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        );
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers,
        });
      }
      if (path.startsWith("/_fia") || path === "/api" || path.startsWith("/api/")) {
        if (!principal) return response("Unauthorized", 401);
      }
      if (path === "/_fia/browser/session" && browser && request.method === "GET")
        return Response.json(
          { generation: init.generation },
          { headers: { "cache-control": "no-store" } },
        );
      if (path === "/_fia/browser/socket" && browser && request.method === "POST") {
        try {
          const input = await json(request);
          if (typeof input.path !== "string") return response("Invalid WebSocket path", 400);
          return Response.json(
            { url: sessions.socketTicket(browser, input.path) },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return response("Invalid WebSocket request", 400);
        }
      }
      if (path.startsWith("/_fia/update/") && request.method === "POST") {
        if (!equal(request.headers.get("x-fia-session") ?? "", init.sessionSecret))
          return response("Forbidden", 403);
        const action = path.slice("/_fia/update/".length);
        if (action !== "prepare" && action !== "resume") return response("Not Found", 404);
        try {
          await update?.(action);
          return Response.json({ result: { ready: true } });
        } catch (error) {
          return apiError(error, 409);
        }
      }
      if (path.startsWith("/_fia/api/") && api) {
        const target = new URL(request.url);
        target.pathname = path.slice("/_fia/api".length);
        return api.fetch(new Request(target, request), "ui");
      }
      if (path === "/_fia/health")
        return Response.json(
          { ready: gateway.ready, generation: init.generation, build: init.build },
          { status: gateway.ready ? 200 : 503 },
        );
      if (path === "/_fia/ready" && request.method === "POST") {
        const body = (await request.json()) as {
          windowId?: string;
          generation?: string;
          browser?: boolean;
        };
        if (body.generation !== init.generation) return response("Stale frontend", 409);
        if (browser) {
          return Response.json({ ok: true });
        }
        await context.native.call("runtime.frontendReady", body);
        return Response.json({ ok: true });
      }
      if (path === "/_fia/native") {
        if (server.upgrade(request, { data: { fiaNative: true } })) return undefined;
        return response("WebSocket required", 426);
      }
      if (
        path.startsWith("/_fia/resources/") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const id = path.slice("/_fia/resources/".length);
        if (!/^[a-f0-9-]{36}$/u.test(id)) return response("Not Found", 404);
        try {
          const resource = await context.native.call<{ path: string; contentType: string }>(
            "resources.resolve",
            { id },
          );
          const file = await realpath(resource.path);
          const root = await realpath(init.resourceDirectory);
          if (!file.startsWith(root + sep)) return response("Forbidden", 403);
          return new Response(request.method === "HEAD" ? null : Bun.file(file), {
            headers: {
              "content-type": resource.contentType,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch {
          return response("Not Found", 404);
        }
      }
      if (path.startsWith("/_fia")) return response("Not Found", 404);
      if (path === "/api" || path.startsWith("/api/")) {
        const target = new URL(url);
        target.pathname = path.slice(4) || "/";
        const forwarded = request as Bun.BunRequest;
        Object.defineProperty(forwarded, "url", { value: target.href, configurable: true });
        for (const rule of rules) {
          const match = rule.pattern.exec(target.pathname);
          if (!match) continue;
          Object.defineProperty(forwarded, "params", {
            value: Object.fromEntries(
              rule.names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)]),
            ),
            configurable: true,
          });
          const handler =
            typeof rule.handler === "function"
              ? rule.handler
              : rule.handler[request.method as Bun.Serve.HTTPMethod];
          if (!handler) return response("Method Not Allowed", 405);
          return (await handler(forwarded as never, server, context)) ?? undefined;
        }
        return definition.http.fetch
          ? ((await definition.http.fetch(forwarded, server, context)) ?? undefined)
          : response("Not Found", 404);
      }
      if (!["GET", "HEAD"].includes(request.method)) return response("Method Not Allowed", 405);
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return response("Bad Request", 400);
      }
      if (!safePath(decoded)) return response("Bad Request", 400);
      const root = await realpath(init.webRoot);
      let candidate = resolve(root, "." + (decoded === "/" ? "/index.html" : decoded));
      try {
        candidate = await realpath(candidate);
      } catch {
        if (decoded.split("/").pop()?.includes(".")) return response("Not Found", 404);
        try {
          candidate = await realpath(resolve(root, "index.html"));
        } catch {
          return response("Not Found", 404);
        }
      }
      if (!candidate.startsWith(root + sep) || !(await Bun.file(candidate).exists()))
        return response("Not Found", 404);
      return new Response(
        request.method === "HEAD"
          ? null
          : candidate.endsWith(".html")
            ? injectBrowserRuntime(await Bun.file(candidate).text())
            : Bun.file(candidate),
        {
          headers: {
            "cache-control": "no-store",
            "content-type": candidate.endsWith(".html")
              ? "text/html; charset=utf-8"
              : Bun.file(candidate).type,
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "content-security-policy": "frame-ancestors 'none'; base-uri 'none'",
          },
        },
      );
    },
    websocket: {
      ...definition.http.websocket,
      maxPayloadLength: definition.http.websocket?.maxPayloadLength ?? 1024 * 1024,
      open(socket: Socket) {
        const envelope = socket.data as
          | { fiaBrowserSession?: BrowserSession; originalData?: unknown }
          | undefined;
        if (envelope?.fiaBrowserSession) {
          const browser = envelope.fiaBrowserSession;
          socket.data = envelope.originalData;
          socketSessions.set(socket, browser);
          browser.sockets.add(socket);
          if (browser.controller.signal.aborted) {
            socket.close(4001, "Browser authorization ended");
            return;
          }
        }
        if ((socket.data as { fiaNative?: boolean })?.fiaNative === true)
          nativeSockets.set(socket, new Map());
        else definition.http.websocket?.open?.(socket);
      },
      async message(socket: Socket, message: string | Buffer<ArrayBuffer>) {
        const pending = nativeSockets.get(socket);
        if (!pending) {
          await definition.http.websocket?.message(socket, message);
          return;
        }
        if (Buffer.byteLength(message) > 1024 * 1024) {
          socket.close(1009, "Native frame is too large");
          return;
        }
        let frame: { v: number; type: string; id: number; method?: string; params?: unknown };
        try {
          frame = JSON.parse(String(message));
        } catch {
          socket.close(1002, "Invalid JSON");
          return;
        }
        if (frame.v !== 1 || !Number.isSafeInteger(frame.id) || frame.id < 1) {
          socket.close(1002, "Invalid frame");
          return;
        }
        if (frame.type === "cancel") {
          pending.get(frame.id)?.abort();
          return;
        }
        if (
          frame.type !== "request" ||
          typeof frame.method !== "string" ||
          pending.has(frame.id) ||
          pending.size >= 128
        ) {
          socket.close(1002, "Invalid request");
          return;
        }
        const controller = new AbortController();
        pending.set(frame.id, controller);
        try {
          if (frame.method.startsWith("runtime.") || frame.method === "resources.resolve")
            throw new Error("Private native method");
          const browser = socketSessions.get(socket);
          if (browser && !browserNativeMethods.has(frame.method))
            throw new APIError(
              "permission_denied",
              "Native capability is not available in the browser",
            );
          let result = await context.native.call(frame.method, frame.params ?? {}, {
            signal: browser
              ? AbortSignal.any([controller.signal, browser.controller.signal])
              : controller.signal,
            timeoutMs:
              frame.method.startsWith("updates.") ||
              frame.method.startsWith("keychain.") ||
              frame.method === "dialogs.openFiles" ||
              frame.method === "dialogs.saveFile"
                ? 0
                : 30_000,
          });
          if (browser && frame.method === "native.capabilities") {
            const value = result as { capabilities: Record<string, boolean> };
            result = {
              ...value,
              capabilities: {
                ...value.capabilities,
                browser: true,
                keychain: false,
                agent: false,
                screenCapture: false,
                globalShortcuts: false,
              },
              methods: [...browserNativeMethods],
            };
          }
          if (nativeSockets.has(socket) && !browser?.controller.signal.aborted)
            socket.send(JSON.stringify({ v: 1, type: "response", id: frame.id, result }));
        } catch (error) {
          if (nativeSockets.has(socket))
            socket.send(
              JSON.stringify({
                v: 1,
                type: "response",
                id: frame.id,
                error: {
                  code: "native_failure",
                  component: "native",
                  message: String(error),
                  recoverable: true,
                  ...(error as object),
                },
              }),
            );
        } finally {
          pending.delete(frame.id);
        }
      },
      close(socket: Socket, code: number, reason: string) {
        socketSessions.get(socket)?.sockets.delete(socket);
        socketSessions.delete(socket);
        const pending = nativeSockets.get(socket);
        if (pending) {
          for (const controller of pending.values()) controller.abort();
          nativeSockets.delete(socket);
        } else definition.http.websocket?.close?.(socket, code, reason);
      },
      drain(socket: Socket) {
        if (!nativeSockets.has(socket)) definition.http.websocket?.drain?.(socket);
      },
      ping(socket: Socket, data: Buffer) {
        if (!nativeSockets.has(socket)) definition.http.websocket?.ping?.(socket, data);
      },
      pong(socket: Socket, data: Buffer) {
        if (!nativeSockets.has(socket)) definition.http.websocket?.pong?.(socket, data);
      },
    } satisfies Bun.WebSocketHandler<unknown>,
  };
  for (const event of [
    "windows.changed",
    "windows.titlebarAction",
    "globalShortcuts.pressed",
    "updates.stateChanged",
  ]) {
    context.native.on(event, (payload) => {
      const message = JSON.stringify({ v: 1, type: "event", event, payload });
      for (const socket of nativeSockets.keys()) socket.send(message);
    });
  }
  return gateway;
}
