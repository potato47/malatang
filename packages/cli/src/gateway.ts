import { APIServer, apiError } from "./api-server.ts";
import { APIError } from "./api-client.ts";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
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
  const browserTickets = new Map<string, number>();
  const cookieName = "fia_" + init.sessionSecret.slice(0, 12);
  const usedTickets = new Set<string>();
  const nativeSockets = new Map<Socket, Map<number, AbortController>>();
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
  function authorized(request: Request, server: Bun.Server<unknown>) {
    const url = new URL(request.url);
    if (!validOrigins(server).some((origin) => new URL(origin).host === url.host)) return false;
    const internal = request.headers.get("x-fia-session");
    if (internal && equal(internal, init.sessionSecret)) return true;
    const origin = request.headers.get("origin");
    if (origin && !validOrigins(server).includes(origin)) return false;
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    return cookie !== undefined && equal(cookie, init.sessionSecret);
  }
  const gateway = {
    ready: false,
    issueBrowserURL(): string {
      if (!init.development || !init.developmentOrigin)
        throw new APIError("forbidden", "Browser tickets are only available in fia dev");
      for (const [ticket, expires] of browserTickets)
        if (expires <= Date.now()) browserTickets.delete(ticket);
      if (browserTickets.size >= 64)
        throw new APIError(
          "resource_limit",
          "Too many outstanding browser tickets; retry after 60 seconds",
        );
      const ticket = randomBytes(32).toString("hex");
      browserTickets.set(ticket, Date.now() + 60_000);
      const url = new URL("/_fia/dev/bootstrap", init.developmentOrigin);
      url.searchParams.set("ticket", ticket);
      return url.href;
    },
    async fetch(request: Request, server: Bun.Server<unknown>): Promise<Response | undefined> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/_fia/dev/bootstrap") {
        if (!init.development || !init.developmentOrigin) return response("Not Found", 404);
        const ticket = url.searchParams.get("ticket") ?? "";
        const expires = browserTickets.get(ticket) ?? 0;
        if (
          request.method !== "GET" ||
          !validOrigins(server).some((origin) => new URL(origin).host === url.host)
        )
          return response("Invalid browser request", 403);
        browserTickets.delete(ticket);
        if (expires <= Date.now()) return response("Invalid or expired browser ticket", 403);
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "/?" + new URLSearchParams({ fiaBrowser: "1", fiaGeneration: init.generation }),
            "set-cookie":
              cookieName + "=" + init.sessionSecret + "; HttpOnly; SameSite=Strict; Path=/",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
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
              cookieName + "=" + init.sessionSecret + "; HttpOnly; SameSite=Strict; Path=/",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      }
      if (path.startsWith("/_fia") || path === "/api" || path.startsWith("/api/")) {
        if (!authorized(request, server)) return response("Unauthorized", 401);
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
        if (body.browser === true) {
          if (!init.development) return response("Browser readiness is development-only", 403);
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
      return new Response(request.method === "HEAD" ? null : Bun.file(candidate), {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    },
    websocket: {
      ...definition.http.websocket,
      maxPayloadLength: definition.http.websocket?.maxPayloadLength ?? 1024 * 1024,
      open(socket: Socket) {
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
          const result = await context.native.call(frame.method, frame.params ?? {}, {
            signal: controller.signal,
            timeoutMs: frame.method.startsWith("updates.") ? 0 : 30_000,
          });
          if (nativeSockets.has(socket))
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
