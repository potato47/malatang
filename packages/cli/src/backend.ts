import { FIA_BACKEND_PROTOCOL_VERSION } from "./metadata.ts";
import {
  NativeError,
  NativeResource,
  type NativeCallOptions,
  type NativeErrorPayload,
  type NativeResourceDescriptor,
  type NativeTransport,
} from "./client.ts";

export { NativeError, NativeResource };
export type { NativeCallOptions, NativeErrorPayload, NativeResourceDescriptor };

const FIA_BACKEND = Symbol.for("@semicoder/fia/backend-definition-v2");
const FIA_RUNTIME = Symbol.for("@semicoder/fia/backend-runtime-v2");
const PROTOCOL = FIA_BACKEND_PROTOCOL_VERSION;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING = 128;

type MaybePromise<Value> = Value | Promise<Value>;
export type BackendServer<WebSocketData = unknown> = Bun.Server<WebSocketData>;

export interface AppContext {
  readonly name: string;
  readonly identifier: string;
  readonly dataDirectory: string;
}

export interface BackendRouteContext {
  readonly native: BackendNativeClient;
  readonly app: AppContext;
}

export type BackendRouteHandler<WebSocketData = unknown, Path extends string = string> = (
  request: Bun.BunRequest<Path>,
  server: BackendServer<WebSocketData>,
  context: BackendRouteContext,
) => MaybePromise<Response | undefined | void>;

export type BackendRoute<WebSocketData = unknown, Path extends string = string> =
  | BackendRouteHandler<WebSocketData, Path>
  | Partial<Record<Bun.Serve.HTTPMethod, BackendRouteHandler<WebSocketData, Path>>>;

export interface BackendHTTPDefinition<
  WebSocketData = unknown,
  RoutePaths extends string = string,
> {
  readonly routes?: Readonly<{ [Path in RoutePaths]: BackendRoute<WebSocketData, Path> }>;
  readonly fetch?: BackendRouteHandler<WebSocketData>;
  readonly websocket?: Bun.WebSocketHandler<WebSocketData>;
  readonly error?: (error: Error) => MaybePromise<Response | undefined | void>;
  readonly maxRequestBodySize?: number;
  readonly idleTimeout?: number;
}

export interface BackendContext<WebSocketData = unknown> extends BackendRouteContext {
  readonly server: BackendServer<WebSocketData>;
  url(path?: string): URL;
}

export interface BackendDefinition<WebSocketData = unknown, RoutePaths extends string = string> {
  readonly [FIA_BACKEND]: true;
  readonly http: BackendHTTPDefinition<WebSocketData, RoutePaths>;
  readonly start?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
  readonly stop?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
}

interface BackendInput<WebSocketData, RoutePaths extends string> {
  readonly http: BackendHTTPDefinition<WebSocketData, RoutePaths>;
  readonly start?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
  readonly stop?: (context: BackendContext<WebSocketData>) => MaybePromise<void>;
}

export function defineBackend<WebSocketData = unknown, const RoutePaths extends string = string>(
  definition: BackendInput<WebSocketData, RoutePaths>,
): BackendDefinition<WebSocketData, RoutePaths> {
  if (!isObject(definition) || !isObject(definition.http))
    throw new TypeError("defineBackend expects an http definition");
  Object.defineProperty(definition, FIA_BACKEND, { value: true, enumerable: false });
  return definition as unknown as BackendDefinition<WebSocketData, RoutePaths>;
}

export function isDefinedBackend(value: unknown): value is BackendDefinition {
  return isObject(value) && (value as Partial<BackendDefinition>)[FIA_BACKEND] === true;
}

interface InitializeFrame {
  readonly v: typeof PROTOCOL;
  readonly type: "initialize";
  readonly sessionSecret: string;
  readonly preferredPort: number;
  readonly development: boolean;
  readonly applicationSupport: string;
  readonly nativeOrigin: string;
  readonly nativeSession: string;
  readonly app: { readonly name: string; readonly identifier: string };
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
}

interface Runtime {
  readonly initialize: InitializeFrame;
  readonly peer: StdioPeer;
  readonly native: BackendNativeClient;
  server?: BackendServer;
  definition?: BackendDefinition;
  context?: BackendContext;
  stopping: boolean;
}

function isObject(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeFrame(frame: unknown): void {
  const data = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(data) > MAX_FRAME_BYTES)
    throw new NativeError({
      code: "invalid_argument",
      component: "backend",
      message: "The Bun transport frame exceeds 1 MiB",
      recoverable: false,
    });
  process.stdout.write(data);
}

async function* frames(): AsyncGenerator<Record<string, unknown>> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      buffer += decoder.decode(item.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error("stdio frame exceeds 1 MiB");
        const frame = JSON.parse(line) as unknown;
        if (!isObject(frame)) throw new Error("invalid stdio frame");
        yield frame as Record<string, unknown>;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

class StdioPeer {
  readonly pending = new Map<number, Pending>();
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  nextID = 1;
  closed = false;

  constructor(private readonly iterator: AsyncIterator<Record<string, unknown>>) {}

  start(): void {
    void this.readLoop();
  }

  on(event: string, listener: (payload: unknown) => void): () => void {
    const current = this.listeners.get(event) ?? new Set();
    current.add(listener);
    this.listeners.set(event, current);
    return () => current.delete(listener);
  }

  async call<Result>(
    method: string,
    params: unknown,
    options: NativeCallOptions = {},
  ): Promise<Result> {
    if (this.closed)
      throw new NativeError({
        code: "protocol_failure",
        component: "backend",
        method,
        message: "Swift Runtime disconnected",
        recoverable: true,
      });
    if (this.pending.size >= MAX_PENDING)
      throw new NativeError({
        code: "resource_limit",
        component: "backend",
        method,
        message: "Native request concurrency limit exceeded",
        recoverable: true,
      });
    if (options.signal?.aborted === true) throw options.signal.reason;
    const id = this.nextID++;
    return await new Promise<Result>((resolve, reject) => {
      const pending: Pending = { method, resolve: (value) => resolve(value as Result), reject };
      this.pending.set(id, pending);
      const retire = (error: unknown): void => {
        if (!this.pending.delete(id)) return;
        if (pending.timer !== undefined) clearTimeout(pending.timer);
        pending.removeAbort?.();
        writeFrame({ v: PROTOCOL, type: "cancel", id });
        reject(error);
      };
      const timeout = options.timeoutMs ?? 30_000;
      if (timeout > 0)
        pending.timer = setTimeout(
          () =>
            retire(
              new NativeError({
                code: "timeout",
                component: "backend",
                method,
                message: `Native method timed out after ${timeout} ms`,
                recoverable: true,
              }),
            ),
          timeout,
        );
      if (options.signal !== undefined) {
        const abort = (): void =>
          retire(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        options.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", abort);
      }
      writeFrame({ v: PROTOCOL, type: "request", id, method, params });
    });
  }

  private async readLoop(): Promise<void> {
    try {
      while (true) {
        const item = await this.iterator.next();
        if (item.done) throw new Error("Swift Runtime closed stdin");
        const frame = item.value;
        if (frame.v !== PROTOCOL || typeof frame.type !== "string")
          throw new Error("invalid stdio protocol version");
        if (frame.type === "response") {
          const id = frame.id;
          if (typeof id !== "number") throw new Error("invalid response ID");
          const pending = this.pending.get(id);
          if (pending === undefined) continue;
          this.pending.delete(id);
          if (pending.timer !== undefined) clearTimeout(pending.timer);
          pending.removeAbort?.();
          if (isObject(frame.error))
            pending.reject(new NativeError(frame.error as unknown as NativeErrorPayload));
          else pending.resolve(frame.result);
        } else if (frame.type === "event" && typeof frame.event === "string") {
          for (const listener of this.listeners.get(frame.event) ?? []) listener(frame.payload);
        } else throw new Error("invalid stdio frame type");
      }
    } catch (error) {
      this.closed = true;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      process.stderr.write(
        `FIA Bun transport failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      runtime()?.server?.stop(true);
    }
  }
}

export class BackendNativeClient extends EventTarget implements NativeTransport {
  constructor(
    private readonly peer: StdioPeer,
    private readonly resourceOrigin: string,
    private readonly resourceSession: string,
  ) {
    super();
  }
  call<Result = unknown>(
    method: string,
    params: unknown = {},
    options?: NativeCallOptions,
  ): Promise<Result> {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(method))
      throw new NativeError({
        code: "invalid_argument",
        component: "backend",
        method,
        message: "Native method name is invalid",
        recoverable: false,
      });
    return this.peer.call<Result>(method, params, options);
  }
  on(event: string, listener: (payload: unknown) => void): () => void {
    return this.peer.on(event, listener);
  }
  resource(descriptor: NativeResourceDescriptor): NativeResource {
    const url = new URL(descriptor.url, this.resourceOrigin);
    if (url.origin !== this.resourceOrigin || !url.pathname.startsWith("/_fia/resources/")) {
      throw new NativeError({
        code: "protocol_failure",
        component: "backend",
        message: "Native resource descriptor escaped the Runtime origin",
        recoverable: false,
      });
    }
    return new NativeResource(descriptor, this, {
      url: url.href,
      credentials: "omit",
      headers: { "x-fia-session": this.resourceSession },
    });
  }
}

function runtime(): Runtime | undefined {
  return (globalThis as typeof globalThis & { [FIA_RUNTIME]?: Runtime })[FIA_RUNTIME];
}

async function sharedRuntime(): Promise<Runtime> {
  const existing = runtime();
  if (existing !== undefined) return existing;
  const iterator = frames()[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new Error("The first Swift frame must initialize Bun protocol v3");
  const value = first.value;
  if (
    value.v !== PROTOCOL ||
    value.type !== "initialize" ||
    typeof value.sessionSecret !== "string" ||
    value.sessionSecret.length < 32 ||
    typeof value.preferredPort !== "number" ||
    typeof value.development !== "boolean" ||
    typeof value.applicationSupport !== "string" ||
    typeof value.nativeOrigin !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d+$/u.test(value.nativeOrigin) ||
    typeof value.nativeSession !== "string" ||
    value.nativeSession.length < 32 ||
    !isObject(value.app) ||
    typeof value.app.name !== "string" ||
    typeof value.app.identifier !== "string"
  )
    throw new Error("Invalid Bun protocol v3 initialize frame");
  const initialize = value as unknown as InitializeFrame;
  const peer = new StdioPeer(iterator);
  const current: Runtime = {
    initialize,
    peer,
    native: new BackendNativeClient(peer, initialize.nativeOrigin, initialize.nativeSession),
    stopping: false,
  };
  (globalThis as typeof globalThis & { [FIA_RUNTIME]?: Runtime })[FIA_RUNTIME] = current;
  peer.start();
  peer.on("runtime.shutdown", () => {
    void shutdown(current);
  });
  return current;
}

function authorize(request: Request, session: string): boolean {
  return request.headers.get("x-fia-backend-session") === session;
}

function routes<WebSocketData>(
  definition: BackendHTTPDefinition<WebSocketData>,
  context: BackendRouteContext,
  session: string,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [path, route] of Object.entries(definition.routes ?? {})) {
    if (!path.startsWith("/") || path.startsWith("/_fia"))
      throw new TypeError(`invalid Backend route: ${path}`);
    if (typeof route === "function") {
      output[path] = (request: Bun.BunRequest, server: BackendServer<WebSocketData>) =>
        authorize(request, session)
          ? route(request as never, server, context)
          : new Response("Unauthorized", { status: 401 });
    } else {
      const methods: Record<string, unknown> = {};
      for (const [method, handler] of Object.entries(route)) {
        if (handler !== undefined)
          methods[method] = (request: Bun.BunRequest, server: BackendServer<WebSocketData>) =>
            authorize(request, session)
              ? handler(request as never, server, context)
              : new Response("Unauthorized", { status: 401 });
      }
      output[path] = methods;
    }
  }
  return output;
}

async function deactivate(current: Runtime): Promise<void> {
  const definition = current.definition;
  const context = current.context;
  current.definition = undefined;
  current.context = undefined;
  if (definition !== undefined && context !== undefined) await definition.stop?.(context);
  current.server?.stop(true);
  current.server = undefined;
}

async function shutdown(current: Runtime): Promise<void> {
  if (current.stopping) return;
  current.stopping = true;
  try {
    await deactivate(current);
  } finally {
    process.exit(0);
  }
}

export async function runBackend(definition: BackendDefinition): Promise<void> {
  if (!isDefinedBackend(definition))
    throw new TypeError("Backend entry must default-export defineBackend()({...})");
  const current = await sharedRuntime();
  await deactivate(current);
  const routeContext: BackendRouteContext = {
    native: current.native,
    app: {
      name: current.initialize.app.name,
      identifier: current.initialize.app.identifier,
      dataDirectory: current.initialize.applicationSupport,
    },
  };
  let port = current.initialize.preferredPort;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    development: current.initialize.development,
    routes: routes(definition.http, routeContext, current.initialize.sessionSecret),
    fetch:
      definition.http.fetch === undefined
        ? () => new Response("Not Found", { status: 404 })
        : (request: Bun.BunRequest, server: BackendServer) =>
            authorize(request, current.initialize.sessionSecret)
              ? definition.http.fetch!(request, server, routeContext)
              : new Response("Unauthorized", { status: 401 }),
    ...(definition.http.websocket === undefined ? {} : { websocket: definition.http.websocket }),
    ...(definition.http.error === undefined ? {} : { error: definition.http.error }),
    ...(definition.http.maxRequestBodySize === undefined
      ? {}
      : { maxRequestBodySize: definition.http.maxRequestBodySize }),
    ...(definition.http.idleTimeout === undefined
      ? {}
      : { idleTimeout: definition.http.idleTimeout }),
  } as never) as BackendServer;
  port = server.port ?? 0;
  const origin = `http://127.0.0.1:${port}`;
  const context: BackendContext = {
    ...routeContext,
    server,
    url(path = "/") {
      return new URL(path, origin);
    },
  };
  current.server = server;
  current.definition = definition;
  current.context = context;
  await definition.start?.(context);
  writeFrame({ v: PROTOCOL, type: "ready", port, origin });
}
