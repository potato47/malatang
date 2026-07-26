import { resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import {
  BackendApplicationError,
  isFIAApplication,
  type DefinedFIAApplication,
  type FIABackendContext,
  type FIARoute,
} from "../runtime.ts";
import { handleEchoMessage } from "./echo.ts";
import {
  PROTOCOL_VERSION,
  MAX_BACKEND_CONCURRENT_REQUESTS,
  MAX_BACKEND_MESSAGE_BYTES,
  ProtocolError,
  decodeLines,
  parseBackendHostLine,
  parseInitializeLine,
  parseShutdownLine,
  serializeReady,
  type InitializeMessage,
} from "./protocol.ts";
import {
  SESSION_COOKIE_NAME,
  bearerToken,
  cookieValue,
  randomToken,
  secretEquals,
} from "./security.ts";

interface DevelopmentOptions {
  mode: "development";
  application: unknown;
  ui: Bun.HTMLBundle;
}

interface ProductionOptions {
  mode: "production";
  application: unknown;
  uiTemplate: string;
}

export type ManagedRuntimeOptions = DevelopmentOptions | ProductionOptions;

interface InternalSocketData {
  readonly __fiaInternal: true;
}

type SocketData = unknown | InternalSocketData;
type RuntimeServer = Server<SocketData>;
type RuntimeSocket = ServerWebSocket<SocketData>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const INTERNAL_SOCKET_DATA: InternalSocketData = Object.freeze({ __fiaInternal: true });
const UI_NONCE_PLACEHOLDER = "__FIA_CSP_NONCE__";
const STATE_KEY = Symbol.for("dev.fia.managed-runtime.state");
const RUNTIME_MARKER = Symbol.for("dev.fia.managed-runtime.controller");
const CONSOLE_KEY = Symbol.for("dev.fia.managed-runtime.console");

function generic(status: number): Response {
  return new Response(status === 404 ? "Not Found" : "Request Rejected", {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function applicationOrThrow(value: unknown): DefinedFIAApplication {
  if (!isFIAApplication(value)) {
    throw new Error(
      "src/server.ts must default-export defineApp({ backend, routes, websocket }). "
        + "Direct Bun.serve() entries are not supported by FIA dev/build/run.",
    );
  }
  if (value.backend === undefined && value.routes === undefined && value.fetch === undefined) {
    throw new Error("defineApp requires backend methods, routes, or fetch");
  }
  if (value.backend !== undefined) {
    if (!isPlainObject(value.backend) || !isPlainObject(value.backend.methods)) {
      throw new Error("defineApp backend must provide a methods object");
    }
    for (const [name, handler] of Object.entries(value.backend.methods)) {
      if (!validBackendName(name) || typeof handler !== "function") {
        throw new Error(`invalid backend method: ${name}`);
      }
    }
  }
  if (value.fetch !== undefined && typeof value.fetch !== "function") {
    throw new Error("defineApp fetch must be a function");
  }
  if (
    value.websocket !== undefined
    && (typeof value.websocket !== "object" || value.websocket === null || typeof value.websocket.message !== "function")
  ) {
    throw new Error("defineApp websocket must provide a message handler");
  }
  for (const [path, route] of Object.entries(value.routes ?? {})) {
    if (!path.startsWith("/")) throw new Error(`application route must start with '/': ${path}`);
    if (path === "/" || path.startsWith("/__fia")) {
      throw new Error(`application route is reserved by FIA: ${path}`);
    }
    validateRoute(path, route);
  }
  return value;
}

function validBackendName(value: string): boolean {
  return value.length > 0
    && Buffer.byteLength(value) <= 256
    && /^[\p{L}\p{N}._-]+$/u.test(value);
}

class BackendProtocolWriter {
  private pending = Promise.resolve();

  write(message: unknown): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_BACKEND_MESSAGE_BYTES) {
      return Promise.reject(new ProtocolError("backend message exceeds 1 MiB"));
    }
    const operation = this.pending.then(async () => {
      await new Promise<void>((resolvePromise, reject) => {
        process.stdout.write(line, (error) => error === null ? resolvePromise() : reject(error));
      });
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}

function validateRoute(path: string, route: unknown): void {
  if (typeof route === "function" || route instanceof Response) return;
  if (!isPlainObject(route)) throw new Error(`unsupported application route value: ${path}`);
  const methods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
  for (const [method, handler] of Object.entries(route)) {
    if (!methods.has(method) || (typeof handler !== "function" && !(handler instanceof Response))) {
      throw new Error(`unsupported application route method: ${method} ${path}`);
    }
  }
}

function redirectConsoleToStderr(): void {
  const globalRecord = globalThis as unknown as Record<PropertyKey, unknown>;
  if (globalRecord[CONSOLE_KEY] === true) return;
  globalRecord[CONSOLE_KEY] = true;
  const write = (...values: unknown[]): void => {
    const message = values.map((value) => typeof value === "string" ? value : Bun.inspect(value)).join(" ");
    process.stderr.write(`${message}\n`);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
  console.warn = write;
  console.error = write;
}

class ManagedRuntime {
  private readonly initialize: InitializeMessage;
  private readonly internalSockets = new WeakSet<RuntimeSocket>();
  private application: DefinedFIAApplication;
  private options: ManagedRuntimeOptions;
  private server?: RuntimeServer;
  private bootstrapToken?: string;
  private readonly controlToken: string;
  private sessionToken?: string;
  private expectedHost = "";
  private origin = "";
  private stopping?: Promise<void>;
  private parentTimer?: ReturnType<typeof setInterval>;
  private readonly backendWriter = new BackendProtocolWriter();
  private readonly backendRequests = new Map<string, AbortController>();

  constructor(initialize: InitializeMessage, options: ManagedRuntimeOptions) {
    Object.defineProperty(this, RUNTIME_MARKER, { value: true });
    this.initialize = initialize;
    this.application = applicationOrThrow(options.application);
    this.options = options;
    this.bootstrapToken = initialize.bootstrapToken;
    this.controlToken = initialize.controlToken;
  }

  start(): void {
    const server = Bun.serve<SocketData>(this.serveOptions());
    const port = server.port;
    if (port === undefined) throw new Error("Bun did not assign a TCP port");
    this.server = server;
    this.expectedHost = `127.0.0.1:${port}`;
    this.origin = `http://${this.expectedHost}`;
    process.stdout.write(serializeReady(port, process.pid));

    this.parentTimer = setInterval(() => {
      if (process.ppid !== this.initialize.parentPid) {
        process.stderr.write("fia-runtime: parent process changed; stopping runtime\n");
        void this.stop().finally(() => process.exit(0));
      }
    }, 1_000);
    this.parentTimer.unref();
  }

  reload(options: ManagedRuntimeOptions): void {
    if (options.mode !== this.options.mode) throw new Error("runtime mode cannot change during hot reload");
    this.application = applicationOrThrow(options.application);
    this.options = options;
    this.server?.reload(this.serveOptions());
  }

  async stop(): Promise<void> {
    if (this.stopping !== undefined) return await this.stopping;
    this.stopping = (async () => {
      for (const controller of this.backendRequests.values()) controller.abort();
      this.backendRequests.clear();
      if (this.parentTimer !== undefined) clearInterval(this.parentTimer);
      this.parentTimer = undefined;
      await this.server?.stop(true);
      this.server = undefined;
    })();
    return await this.stopping;
  }

  handleBackendMessage(line: string): void {
    const request = parseBackendHostLine(line);
    if (request.type === "cancel") {
      this.backendRequests.get(request.id)?.abort();
      return;
    }
    if (this.backendRequests.has(request.id)) throw new ProtocolError("duplicate backend request id");
    if (this.backendRequests.size >= MAX_BACKEND_CONCURRENT_REQUESTS) {
      void this.backendWriter.write({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: request.id,
        ok: false,
        error: { code: "TOO_MANY_REQUESTS", message: "Too many backend requests" },
      }).catch((error) => {
        process.stderr.write(`fia-runtime: backend overload response failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
      return;
    }
    const controller = new AbortController();
    this.backendRequests.set(request.id, controller);
    void this.invokeBackend(request.id, request.method, request.input, controller)
      .catch((error) => {
        process.stderr.write(`fia-runtime: backend response failed: ${error instanceof Error ? error.message : String(error)}\n`);
      })
      .finally(() => this.backendRequests.delete(request.id));
  }

  private async invokeBackend(
    id: string,
    method: string,
    input: unknown,
    controller: AbortController,
  ): Promise<void> {
    const handler = this.application.backend?.methods[method];
    if (handler === undefined) {
      await this.writeBackendFailure(id, "METHOD_NOT_FOUND", "Unknown backend method");
      return;
    }
    const context: FIABackendContext = {
      dataDirectory: this.initialize.dataDirectory,
      requestID: id,
      signal: controller.signal,
      emit: async (name, payload) => {
        if (!validBackendName(name)) throw new BackendApplicationError("INVALID_EVENT", "Event name is invalid");
        await this.backendWriter.write({
          protocol: PROTOCOL_VERSION,
          type: "event",
          name,
          payload: payload === undefined ? null : payload,
        });
      },
    };
    try {
      const value = await handler(input, context);
      if (controller.signal.aborted) return;
      await this.backendWriter.write({
        protocol: PROTOCOL_VERSION,
        type: "response",
        id,
        ok: true,
        value: value === undefined ? null : value,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof BackendApplicationError) {
        if (validBackendName(error.code) && error.message.length > 0 && Buffer.byteLength(error.message) <= 4096) {
          await this.writeBackendFailure(id, error.code, error.message, error.details);
        } else {
          await this.writeBackendFailure(id, "INTERNAL_ERROR", "The backend request failed");
        }
        return;
      }
      process.stderr.write(`fia-runtime: backend request ${id} failed\n`);
      await this.writeBackendFailure(id, "INTERNAL_ERROR", "The backend request failed");
    }
  }

  private async writeBackendFailure(id: string, code: string, message: string, details?: unknown): Promise<void> {
    await this.backendWriter.write({
      protocol: PROTOCOL_VERSION,
      type: "response",
      id,
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
    });
  }

  private serveOptions(): Bun.Serve.Options<SocketData, string> {
    const routes: Record<string, unknown> = {
      "/__fia/bootstrap/:token": (request: Request) => this.bootstrap(request),
      "/__fia/health": (request: Request) => this.health(request),
      "/__fia/ws": (request: Request, server: RuntimeServer) => this.internalUpgrade(request, server),
    };
    for (const [path, route] of Object.entries(this.application.routes ?? {})) {
      routes[path] = this.protectRoute(route);
    }
    if (this.options.mode === "development") {
      routes["/"] = this.options.ui;
    } else {
      routes["/"] = (request: Request) => this.productionUI(request);
    }

    const applicationFetch = this.application.fetch;
    const applicationWebSocket = this.application.websocket;
    const websocket = {
      ...applicationWebSocket,
      maxPayloadLength: Math.min(applicationWebSocket?.maxPayloadLength ?? 64 * 1024, 64 * 1024),
      idleTimeout: applicationWebSocket?.idleTimeout ?? 30,
      backpressureLimit: Math.min(applicationWebSocket?.backpressureLimit ?? 64 * 1024, 64 * 1024),
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
      open: (socket: RuntimeSocket) => {
        if (socket.data === INTERNAL_SOCKET_DATA || (socket.data as InternalSocketData)?.__fiaInternal === true) {
          this.internalSockets.add(socket);
          return;
        }
        applicationWebSocket?.open?.(socket as never);
      },
      message: (socket: RuntimeSocket, message: string | Buffer) => {
        if (!this.internalSockets.has(socket)) {
          applicationWebSocket?.message(socket as never, message as never);
          return;
        }
        if (typeof message !== "string") {
          socket.close(1003, "text messages only");
          return;
        }
        const result = handleEchoMessage(message);
        if (result === undefined) {
          socket.close(1007, "invalid message");
          return;
        }
        socket.send(JSON.stringify(result));
      },
      close: (socket: RuntimeSocket, code: number, reason: string) => {
        if (this.internalSockets.has(socket)) return;
        applicationWebSocket?.close?.(socket as never, code, reason);
      },
      drain: (socket: RuntimeSocket) => {
        if (this.internalSockets.has(socket)) return;
        applicationWebSocket?.drain?.(socket as never);
      },
      ping: (socket: RuntimeSocket, data: Buffer) => {
        if (this.internalSockets.has(socket)) return;
        applicationWebSocket?.ping?.(socket as never, data);
      },
      pong: (socket: RuntimeSocket, data: Buffer) => {
        if (this.internalSockets.has(socket)) return;
        applicationWebSocket?.pong?.(socket as never, data);
      },
    } satisfies Bun.WebSocketHandler<SocketData>;

    return {
      hostname: "127.0.0.1",
      port: 0,
      id: "fia-managed-runtime",
      maxRequestBodySize: 64 * 1024,
      idleTimeout: 10,
      development: this.options.mode === "development"
        ? { hmr: true, console: true, chromeDevToolsAutomaticWorkspaceFolders: false }
        : false,
      routes: routes as Bun.Serve.RoutesWithUpgrade<SocketData, string>,
      fetch: async (request, server) => {
        const rejected = this.applicationRejection(request);
        if (rejected !== undefined) return rejected;
        if (applicationFetch === undefined) return generic(404);
        return await applicationFetch(request as Bun.BunRequest<string>, server as never) ?? generic(404);
      },
      websocket,
      error: (error) => {
        process.stderr.write(`fia-runtime: request failed: ${error.message}\n`);
        return generic(500);
      },
    };
  }

  private protectRoute(route: FIARoute): unknown {
    if (typeof route === "function") {
      return async (request: Bun.BunRequest<string>, server: RuntimeServer) => {
        const rejected = this.applicationRejection(request);
        if (rejected !== undefined) return rejected;
        return await route(request, server as never) ?? generic(404);
      };
    }
    if (route instanceof Response) {
      return (request: Request) => this.applicationRejection(request) ?? route.clone();
    }
    const wrapped: Record<string, unknown> = {};
    for (const [method, handler] of Object.entries(route)) {
      wrapped[method] = typeof handler === "function"
        ? async (request: Bun.BunRequest<string>, server: RuntimeServer) => {
          const rejected = this.applicationRejection(request);
          if (rejected !== undefined) return rejected;
          return await handler(request, server as never) ?? generic(404);
        }
        : (request: Request) => this.applicationRejection(request) ?? handler!.clone();
    }
    return wrapped;
  }

  private baseRejection(request: Request): Response | undefined {
    if (request.headers.get("host") !== this.expectedHost) return generic(421);
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin !== null && requestOrigin !== this.origin) return generic(403);
    if (!SAFE_METHODS.has(request.method) && requestOrigin !== this.origin) return generic(403);
    return undefined;
  }

  private applicationRejection(request: Request): Response | undefined {
    const base = this.baseRejection(request);
    if (base !== undefined) return base;
    const supplied = cookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
    return secretEquals(supplied, this.sessionToken) ? undefined : generic(401);
  }

  private bootstrap(request: Request): Response {
    const base = this.baseRejection(request);
    if (base !== undefined) return base;
    if (request.method !== "GET") return generic(404);
    const supplied = new URL(request.url).pathname.slice("/__fia/bootstrap/".length);
    if (!secretEquals(supplied, this.bootstrapToken)) return generic(404);
    this.bootstrapToken = undefined;
    this.sessionToken = randomToken();
    return new Response(null, {
      status: 303,
      headers: {
        "Cache-Control": "no-store",
        Location: "/",
        "Set-Cookie": `${SESSION_COOKIE_NAME}=${this.sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  private health(request: Request): Response {
    const base = this.baseRejection(request);
    if (base !== undefined) return base;
    if (request.method !== "GET") return generic(404);
    if (!secretEquals(bearerToken(request.headers.get("authorization")), this.controlToken)) {
      return generic(401);
    }
    return json({ protocol: PROTOCOL_VERSION, status: "ok", pid: process.pid });
  }

  private internalUpgrade(request: Request, server: RuntimeServer): Response | undefined {
    const rejected = this.applicationRejection(request);
    if (rejected !== undefined) return rejected;
    const protocols = request.headers.get("sec-websocket-protocol")?.split(",").map((item) => item.trim());
    if (!protocols?.includes("fia.v1")) return generic(426);
    const upgraded = server.upgrade(request, {
      data: INTERNAL_SOCKET_DATA,
      headers: { "Sec-WebSocket-Protocol": "fia.v1" },
    });
    return upgraded ? undefined : generic(400);
  }

  private productionUI(request: Request): Response {
    const rejected = this.applicationRejection(request);
    if (rejected !== undefined) return rejected;
    if (request.method !== "GET" && request.method !== "HEAD") return generic(404);
    const options = this.options;
    if (options.mode !== "production") return generic(500);
    const nonce = randomToken();
    const html = options.uiTemplate.replaceAll(UI_NONCE_PLACEHOLDER, nonce);
    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": [
          "default-src 'none'",
          "base-uri 'none'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          `script-src 'nonce-${nonce}'`,
          `style-src 'nonce-${nonce}'`,
          "img-src 'self' data:",
          "font-src 'self' data:",
          "connect-src 'self'",
        ].join("; "),
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    });
  }
}

async function initializeRuntime(options: ManagedRuntimeOptions): Promise<ManagedRuntime> {
  const lines = decodeLines(Bun.stdin.stream(), MAX_BACKEND_MESSAGE_BYTES);
  const iterator = lines[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new ProtocolError("stdin closed before initialize");
  const initialize = parseInitializeLine(first.value);
  if (resolve(initialize.dataDirectory) !== resolve(process.cwd())) {
    throw new ProtocolError("runtime working directory does not match dataDirectory");
  }

  const runtime = new ManagedRuntime(initialize, options);
  runtime.start();
  const finish = (): void => {
    void runtime.stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", finish);
  process.once("SIGINT", finish);
  void (async () => {
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        if (next.value.length === 0) continue;
        const parsed = JSON.parse(next.value) as { type?: unknown };
        if (parsed.type === "shutdown") {
          parseShutdownLine(next.value);
          break;
        }
        runtime.handleBackendMessage(next.value);
      }
      finish();
    } catch (error) {
      process.stderr.write(`fia-runtime: ${error instanceof Error ? error.message : String(error)}\n`);
      await runtime.stop();
      process.exit(64);
    }
  })();
  return runtime;
}

export async function startManagedRuntime(options: ManagedRuntimeOptions): Promise<void> {
  redirectConsoleToStderr();
  const globalRecord = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = globalRecord[STATE_KEY];
  if (
    typeof existing === "object"
    && existing !== null
    && (existing as Record<PropertyKey, unknown>)[RUNTIME_MARKER] === true
    && typeof (existing as { reload?: unknown }).reload === "function"
  ) {
    (existing as ManagedRuntime).reload(options);
    return;
  }
  try {
    const runtime = await initializeRuntime(options);
    globalRecord[STATE_KEY] = runtime;
  } catch (error) {
    process.stderr.write(`fia-runtime: ${error instanceof Error ? error.message : "unknown startup failure"}\n`);
    process.exit(64);
  }
}
