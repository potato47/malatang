import { timingSafeEqual } from "node:crypto";
import { DesktopSession, HostError } from "./desktop.ts";
import type { CallOptions, Desktop, HostErrorCode } from "./desktop.ts";
import { createRawHost, HostEventScope } from "./raw-host.ts";

export { HostError };
export type {
  BrowserWindow,
  BrowserWindowChangeDetail,
  BrowserWindowCloseDetail,
  BrowserWindowEventMap,
  BrowserWindowOptions,
  BrowserWindowState,
  CallOptions,
  Desktop,
  DesktopState,
  Dock,
  DockEventMap,
  FileDialogOptions,
  GlobalShortcut,
  GlobalShortcutEventMap,
  GlobalShortcutModifier,
  GlobalShortcutPressedDetail,
  GlobalShortcuts,
  HostErrorCode,
  MenuClickDetail,
  MenuEntry,
  MenuItem,
  MenuItemEntry,
  MenuItemPatch,
  NotificationAuthorizationStatus,
  NotificationClickDetail,
  NotificationEventMap,
  NotificationOptions,
  NotificationReceipt,
  Notifications,
  OpenDirectoryDialogOptions,
  OpenFileDialogOptions,
  SaveFileDialogOptions,
  ScreenCaptureAuthorizationResult,
  ScreenCaptureAuthorizationStatus,
  ScreenCaptureOptions,
  ScreenCaptureReceipt,
  ScreenCaptureRegion,
  ScreenInfo,
  SubmenuEntry,
  Tray,
  TrayClickDetail,
  TrayEventMap,
  WindowDragRegion,
  WindowFrame,
  WindowManager,
} from "./desktop.ts";

const FIA_BACKEND = Symbol.for("@semicoder/fia/backend-definition");
const FIA_RUNTIME = Symbol.for("@semicoder/fia/backend-runtime");
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 128;
const REQUEST_TIMEOUT_MS = 30_000;
const STDIO_PROTOCOL_VERSION = 2 as const;
const BOOTSTRAP_TTL_MS = 30_000;
const COOKIE_NAME = "fia_session";
const RESERVED_PATH_PREFIX = "/_fia/";
const HOST_ERROR_CODES = new Set<HostErrorCode>([
  "INVALID_REQUEST",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "UNSAFE_STATE",
  "NATIVE_FAILURE",
  "PROTOCOL_FAILURE",
  "TIMEOUT",
  "CANCELLED",
  "CONFLICT",
  "PERMISSION_DENIED",
]);

type MaybePromise<Value> = Value | Promise<Value>;
export type BackendServer<WebSocketData = unknown> = Bun.Server<WebSocketData>;

export interface AppContext {
  readonly name: string;
  readonly identifier: string;
  readonly dataDirectory: string;
}

export interface RouteContext {
  readonly desktop: Desktop;
  readonly app: AppContext;
}

export type RouteHandler<WebSocketData = unknown, Path extends string = string> = (
  request: Bun.BunRequest<Path>,
  server: BackendServer<WebSocketData>,
  context: RouteContext,
) => MaybePromise<Response | undefined | void>;

export type ProtectedRoute<WebSocketData = unknown, Path extends string = string> =
  | RouteHandler<WebSocketData, Path>
  | Partial<Record<Bun.Serve.HTTPMethod, RouteHandler<WebSocketData, Path>>>;

export type PublicRoute = Response | false | Bun.HTMLBundle | Bun.BunFile;

export interface HTTPDefinition<WebSocketData = unknown, RoutePaths extends string = string> {
  publicRoutes?: Readonly<Record<string, PublicRoute>>;
  routes?: Readonly<{
    [Path in RoutePaths]: ProtectedRoute<WebSocketData, Path>;
  }>;
  fetch?: RouteHandler<WebSocketData>;
  websocket?: Bun.WebSocketHandler<WebSocketData>;
  error?: (error: Error) => MaybePromise<Response | undefined | void>;
  maxRequestBodySize?: number;
  idleTimeout?: number;
}

export interface BackendContext<WebSocketData = unknown> extends RouteContext {
  readonly server: BackendServer<WebSocketData>;
  url(path?: string): URL;
}

export interface BackendDefinition<WebSocketData = unknown, RoutePaths extends string = string> {
  readonly [FIA_BACKEND]: true;
  readonly http: HTTPDefinition<WebSocketData, RoutePaths>;
  readonly start?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
  readonly stop?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
}

interface BackendInput<WebSocketData, RoutePaths extends string> {
  http: HTTPDefinition<WebSocketData, RoutePaths>;
  start?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
  stop?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
}

export function defineBackend<WebSocketData = unknown>(): <const RoutePaths extends string>(
  definition: BackendInput<WebSocketData, RoutePaths>,
) => BackendDefinition<WebSocketData, RoutePaths>;
export function defineBackend<WebSocketData = unknown>(...unexpected: never[]) {
  if (unexpected.length !== 0) {
    throw new TypeError(
      "defineBackend now uses defineBackend<SocketData>()({...}) or defineBackend()({...})",
    );
  }
  return <const RoutePaths extends string>(
    definition: BackendInput<WebSocketData, RoutePaths>,
  ): BackendDefinition<WebSocketData, RoutePaths> => {
    if (!isPlainObject(definition) || !isPlainObject(definition.http)) {
      throw new TypeError("defineBackend expects an object with an http definition");
    }
    Object.defineProperty(definition, FIA_BACKEND, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return definition as unknown as BackendDefinition<WebSocketData, RoutePaths>;
  };
}

export function isDefinedBackend(value: unknown): value is BackendDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<BackendDefinition>)[FIA_BACKEND] === true
  );
}

interface InitializeFrame {
  readonly v: typeof STDIO_PROTOCOL_VERSION;
  readonly type: "initialize";
  readonly sessionSecret: string;
  readonly preferredPort: number;
  readonly development: boolean;
  readonly applicationSupport: string;
  readonly app: { readonly name: string; readonly identifier: string };
}

interface RequestFrame {
  readonly v: typeof STDIO_PROTOCOL_VERSION;
  readonly type: "request";
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface CancelFrame {
  readonly v: typeof STDIO_PROTOCOL_VERSION;
  readonly type: "cancel";
  readonly id: number;
}

interface ResponseFrame {
  readonly v: typeof STDIO_PROTOCOL_VERSION;
  readonly type: "response";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: HostErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

interface EventFrame {
  readonly v: typeof STDIO_PROTOCOL_VERSION;
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
}

type IncomingFrame = InitializeFrame | ResponseFrame | EventFrame;

interface StdioCallOptions extends CallOptions {
  readonly timeout?: boolean;
}

interface PendingHostRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
  retired: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeFrame(value: unknown): string {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
    throw new HostError("INVALID_ARGUMENT", "The stdio frame exceeds the 1 MiB limit");
  }
  return line;
}

async function* readFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) throw new HostError("PROTOCOL_FAILURE", "Empty stdio frame");
        if (Buffer.byteLength(line) + 1 > MAX_FRAME_BYTES) {
          throw new HostError("PROTOCOL_FAILURE", "The stdio frame exceeds the 1 MiB limit");
        }
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          throw new HostError("PROTOCOL_FAILURE", "Invalid JSON on stdin");
        }
        yield frame;
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
        throw new HostError("PROTOCOL_FAILURE", "The stdio frame exceeds the 1 MiB limit");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) throw new HostError("PROTOCOL_FAILURE", "Truncated stdio frame");
  } finally {
    reader.releaseLock();
  }
}

class StdioPeer {
  readonly #iterator: AsyncIterator<unknown>;
  readonly #pending = new Map<number, PendingHostRequest>();
  readonly #listeners = new Map<string, Set<(payload: unknown) => void>>();
  #nextID = 1;
  #closed = false;

  constructor(
    iterator: AsyncIterator<unknown>,
    private readonly onProtocolFailure: (error: unknown) => void,
  ) {
    this.#iterator = iterator;
  }

  start(): void {
    void this.#readLoop();
  }

  on(event: string, listener: (payload: unknown) => void): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  async call<Result>(
    method: string,
    params: Record<string, unknown> = {},
    options: StdioCallOptions = {},
  ): Promise<Result> {
    if (this.#closed) throw new HostError("PROTOCOL_FAILURE", "The Host connection is closed");
    if (options.signal?.aborted === true)
      throw new DOMException("The Host request was aborted", "AbortError");
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      throw new HostError("UNSAFE_STATE", "The Host request concurrency limit was exceeded");
    }
    const id = this.#nextID++;
    let resolveResult: (value: Result | PromiseLike<Result>) => void = () => {};
    let rejectResult: (reason?: unknown) => void = () => {};
    const result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const pending: PendingHostRequest = {
      resolve: (value) => resolveResult(value as Result),
      reject: rejectResult,
      retired: false,
    };
    this.#pending.set(id, pending);
    const retire = (error: unknown): void => {
      if (pending.retired || !this.#pending.has(id)) return;
      pending.retired = true;
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      pending.reject(error);
      try {
        this.write({ v: STDIO_PROTOCOL_VERSION, type: "cancel", id } satisfies CancelFrame);
      } catch (writeError) {
        this.onProtocolFailure(writeError);
      }
    };
    try {
      this.write({
        v: STDIO_PROTOCOL_VERSION,
        type: "request",
        id,
        method,
        params,
      } satisfies RequestFrame);
    } catch (error) {
      this.#pending.delete(id);
      pending.reject(error);
      return await result;
    }
    if (options.signal !== undefined) {
      const abort = (): void =>
        retire(new DOMException("The Host request was aborted", "AbortError"));
      options.signal.addEventListener("abort", abort, { once: true });
      pending.removeAbortListener = () => options.signal?.removeEventListener("abort", abort);
    }
    if (options.timeout !== false) {
      pending.timer = setTimeout(
        () => retire(new HostError("TIMEOUT", `Host request timed out: ${method}`)),
        REQUEST_TIMEOUT_MS,
      );
    }
    return await result;
  }

  write(frame: unknown): void {
    process.stdout.write(encodeFrame(frame));
  }

  async #readLoop(): Promise<void> {
    try {
      while (true) {
        const item = await this.#iterator.next();
        if (item.done) throw new HostError("PROTOCOL_FAILURE", "Host stdin closed");
        const frame = item.value as IncomingFrame;
        if (
          !isPlainObject(frame) ||
          frame.v !== STDIO_PROTOCOL_VERSION ||
          typeof frame.type !== "string"
        ) {
          throw new HostError("PROTOCOL_FAILURE", "Invalid stdio envelope");
        }
        if (frame.type === "response") {
          validateResponseFrame(frame);
          const pending = this.#pending.get(frame.id);
          if (pending === undefined) throw new HostError("PROTOCOL_FAILURE", "Unknown response ID");
          this.#pending.delete(frame.id);
          if (pending.timer !== undefined) clearTimeout(pending.timer);
          pending.removeAbortListener?.();
          if (pending.retired) continue;
          if (frame.error !== undefined) {
            pending.reject(
              new HostError(frame.error.code, frame.error.message, frame.error.details),
            );
          } else {
            pending.resolve(frame.result);
          }
          continue;
        }
        if (frame.type === "event") {
          validateEventFrame(frame);
          for (const listener of this.#listeners.get(frame.event) ?? []) listener(frame.payload);
          continue;
        }
        throw new HostError("PROTOCOL_FAILURE", `Unexpected stdio frame: ${frame.type}`);
      }
    } catch (error) {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        pending.removeAbortListener?.();
        if (!pending.retired) pending.reject(error);
      }
      this.#pending.clear();
      this.onProtocolFailure(error);
    }
  }
}

class SessionGuard {
  readonly #secret: string;
  readonly #bootstrap = new Map<string, { expires: number; target: string }>();
  #origin: string | undefined;

  constructor(secret: string) {
    this.#secret = secret;
  }

  setOrigin(origin: string): void {
    this.#origin = origin;
  }

  authorizeURL(rawURL: string): string {
    const url = new URL(rawURL);
    if (url.origin !== this.#origin) return rawURL;
    const code = crypto.randomUUID();
    const target = `${url.pathname}${url.search}${url.hash}`;
    this.#bootstrap.set(code, { expires: Date.now() + BOOTSTRAP_TTL_MS, target });
    const bootstrap = new URL(`${RESERVED_PATH_PREFIX}bootstrap`, this.#origin);
    bootstrap.searchParams.set("code", code);
    return bootstrap.href;
  }

  bootstrap(request: Request, port: number): Response | undefined {
    const url = new URL(request.url);
    if (url.pathname !== `${RESERVED_PATH_PREFIX}bootstrap`) return undefined;
    const origin = request.headers.get("origin");
    if (
      request.method !== "GET" ||
      request.headers.get("host") !== `127.0.0.1:${port}` ||
      (origin !== null && origin !== this.#origin)
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    const code = url.searchParams.get("code");
    const value = code === null ? undefined : this.#bootstrap.get(code);
    if (code !== null) this.#bootstrap.delete(code);
    if (value === undefined || value.expires < Date.now()) {
      return new Response("Invalid or expired FIA session link", { status: 403 });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: value.target,
        "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(this.#secret)}; HttpOnly; SameSite=Strict; Path=/`,
        "cache-control": "no-store",
      },
    });
  }

  isAuthorized(request: Request, port: number): boolean {
    if (request.headers.get("host") !== `127.0.0.1:${port}`) return false;
    const cookies = request.headers.get("cookie") ?? "";
    const encoded = cookies
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    if (encoded === undefined) return false;
    let candidate: string;
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      return false;
    }
    const expectedBytes = Buffer.from(this.#secret);
    const candidateBytes = Buffer.from(candidate);
    if (expectedBytes.length !== candidateBytes.length) return false;
    if (!timingSafeEqual(expectedBytes, candidateBytes)) return false;
    const origin = request.headers.get("origin");
    return origin === null || origin === this.#origin;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function validateInitializeFrame(value: unknown): InitializeFrame {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      "v",
      "type",
      "sessionSecret",
      "preferredPort",
      "development",
      "applicationSupport",
      "app",
    ]) ||
    value.v !== STDIO_PROTOCOL_VERSION ||
    value.type !== "initialize" ||
    typeof value.sessionSecret !== "string" ||
    value.sessionSecret.length < 32 ||
    !Number.isInteger(value.preferredPort) ||
    (value.preferredPort as number) < 0 ||
    (value.preferredPort as number) > 65_535 ||
    typeof value.development !== "boolean" ||
    typeof value.applicationSupport !== "string" ||
    value.applicationSupport.length === 0 ||
    !isPlainObject(value.app) ||
    !hasExactKeys(value.app, ["name", "identifier"]) ||
    typeof value.app.name !== "string" ||
    value.app.name.length === 0 ||
    typeof value.app.identifier !== "string" ||
    value.app.identifier.length === 0
  ) {
    throw new HostError("PROTOCOL_FAILURE", "Invalid initialize frame");
  }
  return value as unknown as InitializeFrame;
}

function validateResponseFrame(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & ResponseFrame {
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (
    !hasExactKeys(value, ["v", "type", "id"], ["result", "error"]) ||
    value.v !== STDIO_PROTOCOL_VERSION ||
    value.type !== "response" ||
    !Number.isInteger(value.id) ||
    (value.id as number) <= 0 ||
    hasResult === hasError
  ) {
    throw new HostError("PROTOCOL_FAILURE", "Invalid response frame");
  }
  if (hasError) {
    const error = value.error;
    if (
      !isPlainObject(error) ||
      !hasExactKeys(error, ["code", "message"], ["details"]) ||
      typeof error.code !== "string" ||
      !HOST_ERROR_CODES.has(error.code as HostErrorCode) ||
      typeof error.message !== "string" ||
      error.message.length === 0
    ) {
      throw new HostError("PROTOCOL_FAILURE", "Invalid Host error response");
    }
  }
}

function validateEventFrame(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & EventFrame {
  if (
    !hasExactKeys(value, ["v", "type", "event"], ["payload"]) ||
    value.v !== STDIO_PROTOCOL_VERSION ||
    value.type !== "event" ||
    typeof value.event !== "string" ||
    value.event.length === 0
  ) {
    throw new HostError("PROTOCOL_FAILURE", "Invalid event frame");
  }
}

function wrapProtectedRoutes<WebSocketData, RoutePaths extends string>(
  routes:
    | Readonly<{
        [Path in RoutePaths]: ProtectedRoute<WebSocketData, Path>;
      }>
    | undefined,
  authorized: (request: Request) => boolean,
  context: RouteContext,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [path, route] of Object.entries(routes ?? {})) {
    if (path.startsWith(RESERVED_PATH_PREFIX)) {
      throw new HostError("INVALID_ARGUMENT", `${RESERVED_PATH_PREFIX} routes are reserved`);
    }
    if (typeof route === "function") {
      output[path] = (request: Bun.BunRequest, server: BackendServer<WebSocketData>) =>
        authorized(request)
          ? route(request as never, server, context)
          : new Response("Unauthorized", { status: 401 });
      continue;
    }
    const methods: Record<string, unknown> = {};
    const routeMethods = route as unknown as Partial<
      Record<Bun.Serve.HTTPMethod, RouteHandler<WebSocketData>>
    >;
    for (const [method, handler] of Object.entries(routeMethods)) {
      if (handler === undefined) continue;
      methods[method] = (request: Bun.BunRequest, server: BackendServer<WebSocketData>) =>
        authorized(request)
          ? handler(request as never, server, context)
          : new Response("Unauthorized", { status: 401 });
    }
    output[path] = methods;
  }
  return output;
}

interface SharedBackendRuntime {
  readonly initialize: InitializeFrame;
  readonly peer: StdioPeer;
  readonly session: SessionGuard;
  server?: BackendServer<unknown>;
  definition?: BackendDefinition;
  context?: BackendContext;
  desktopSession?: DesktopSession;
  hostEvents?: HostEventScope;
  ready: boolean;
  stopping: boolean;
}

function runtimeGlobal(): typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime } {
  return globalThis as typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime };
}

async function deactivateDefinition(
  runtime: SharedBackendRuntime,
  options: { clearGlobalShortcuts: boolean },
): Promise<void> {
  const definition = runtime.definition;
  const context = runtime.context;
  const desktopSession = runtime.desktopSession;
  const hostEvents = runtime.hostEvents;
  const active = definition !== undefined && context !== undefined;
  runtime.definition = undefined;
  runtime.context = undefined;
  runtime.desktopSession = undefined;
  runtime.hostEvents = undefined;
  hostEvents?.dispose();
  try {
    if (active && options.clearGlobalShortcuts) {
      await runtime.peer.call("globalShortcuts.set", { shortcuts: [] });
    }
    if (active) await definition.stop?.(context);
  } finally {
    try {
      if (active && options.clearGlobalShortcuts) {
        await runtime.peer.call("globalShortcuts.set", { shortcuts: [] });
      }
    } finally {
      desktopSession?.dispose();
    }
  }
}

async function sharedRuntime(): Promise<SharedBackendRuntime> {
  const global = runtimeGlobal();
  if (global[FIA_RUNTIME] !== undefined) return global[FIA_RUNTIME];
  const frames = readFrames(Bun.stdin.stream())[Symbol.asyncIterator]();
  const first = await frames.next();
  if (first.done) {
    throw new HostError("PROTOCOL_FAILURE", "The first Host frame must be initialize v2");
  }
  const initialize = validateInitializeFrame(first.value);
  const peer = new StdioPeer(frames, (error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FIA stdio protocol failure: ${message}\n`);
    const current = runtimeGlobal()[FIA_RUNTIME];
    void Promise.resolve(current?.server?.stop(true)).finally(() => process.exit(70));
  });
  const runtime: SharedBackendRuntime = {
    initialize,
    peer,
    session: new SessionGuard(initialize.sessionSecret),
    ready: false,
    stopping: false,
  };
  global[FIA_RUNTIME] = runtime;
  peer.start();
  peer.on("host.shutdown", () => {
    const current = runtimeGlobal()[FIA_RUNTIME];
    if (current === undefined || current.stopping) return;
    current.stopping = true;
    void (async () => {
      try {
        await deactivateDefinition(current, { clearGlobalShortcuts: false });
      } catch (error) {
        process.stderr.write(
          `FIA Backend stop hook failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
      } finally {
        await current.server?.stop(true);
        process.exit(0);
      }
    })();
  });
  return runtime;
}

export async function runBackend(definition: BackendDefinition): Promise<void> {
  if (!isDefinedBackend(definition))
    throw new TypeError("Backend entry must default-export defineBackend()({...})");
  const runtime = await sharedRuntime();
  await deactivateDefinition(runtime, { clearGlobalShortcuts: true });
  const { initialize, peer, session } = runtime;
  const hostEvents = new HostEventScope();
  const desktopSession = new DesktopSession(createRawHost(peer, session, hostEvents));
  const routeContext: RouteContext = {
    desktop: desktopSession,
    app: {
      name: initialize.app.name,
      identifier: initialize.app.identifier,
      dataDirectory: initialize.applicationSupport,
    },
  };
  let port = runtime.server?.port ?? initialize.preferredPort;
  let server: BackendServer<unknown>;
  try {
    const publicRoutes = definition.http.publicRoutes ?? {};
    for (const path of Object.keys(publicRoutes)) {
      if (path.startsWith(RESERVED_PATH_PREFIX)) {
        throw new HostError("INVALID_ARGUMENT", `${RESERVED_PATH_PREFIX} routes are reserved`);
      }
    }
    const authorize = (request: Request): boolean => session.isAuthorized(request, port);
    const routes: Record<string, unknown> = {
      ...publicRoutes,
      ...wrapProtectedRoutes(definition.http.routes, authorize, routeContext),
      [`${RESERVED_PATH_PREFIX}bootstrap`]: (request: Request) =>
        session.bootstrap(request, port) ?? new Response("Not Found", { status: 404 }),
      [`${RESERVED_PATH_PREFIX}health`]: new Response(null, { status: 204 }),
    };

    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      id: "fia-backend",
      development: initialize.development ? { hmr: true, console: true } : false,
      routes,
      fetch:
        definition.http.fetch === undefined
          ? () => new Response("Not Found", { status: 404 })
          : (request: Request, server: BackendServer<unknown>) =>
              authorize(request)
                ? definition.http.fetch!(request as Bun.BunRequest, server, routeContext)
                : new Response("Unauthorized", { status: 401 }),
      ...(definition.http.websocket === undefined ? {} : { websocket: definition.http.websocket }),
      ...(definition.http.error === undefined ? {} : { error: definition.http.error }),
      ...(definition.http.maxRequestBodySize === undefined
        ? {}
        : { maxRequestBodySize: definition.http.maxRequestBodySize }),
      ...(definition.http.idleTimeout === undefined
        ? {}
        : { idleTimeout: definition.http.idleTimeout }),
    } as never) as BackendServer<unknown>;
  } catch (error) {
    hostEvents.dispose();
    desktopSession.dispose();
    throw error;
  }
  port = server.port ?? 0;
  const origin = `http://127.0.0.1:${port}`;
  session.setOrigin(origin);
  const context: BackendContext = {
    ...routeContext,
    server,
    url(path = "/") {
      return new URL(path, origin);
    },
  };
  runtime.server = server;
  runtime.definition = definition;
  runtime.context = context;
  runtime.desktopSession = desktopSession;
  runtime.hostEvents = hostEvents;
  try {
    await definition.start?.(context);
  } catch (error) {
    try {
      await deactivateDefinition(runtime, { clearGlobalShortcuts: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Backend start failed and its Host resources could not be fully released",
      );
    }
    throw error;
  }
  if (!runtime.ready) {
    if (initialize.development && process.env.FIA_INTERNAL_PRINT_SESSION_URL === "1") {
      process.stderr.write(`FIA_DEV_SESSION_URL=${session.authorizeURL(context.url("/").href)}\n`);
    }
    runtime.ready = true;
    peer.write({ v: STDIO_PROTOCOL_VERSION, type: "ready", port, origin });
  }
}
