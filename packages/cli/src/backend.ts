import { APIServer } from "./api-server.ts";
import { startAgentServer } from "./agent-server.ts";
import type { APIImplementation, APIContract, APIEmitter } from "./business-api.ts";
export { implementAPI } from "./business-api.ts";
import { createGateway } from "./gateway.ts";
import { resolve } from "node:path";
import { createNativeAPI } from "./api.ts";
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

const FIA_BACKEND = Symbol.for("@semicoder/fia/backend-definition-v4");
const FIA_RUNTIME = Symbol.for("@semicoder/fia/backend-runtime-v4");
const PROTOCOL = FIA_BACKEND_PROTOCOL_VERSION;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING = 128;

type MaybePromise<Value> = Value | Promise<Value>;
export type BackendServer<WebSocketData = unknown> = Bun.Server<WebSocketData>;

export interface AppContext {
  readonly name: string;
  readonly identifier: string;
  readonly dataDirectory: string;
  /** Read-only code and configured business assets; never store user data here. */
  readonly codeDirectory: string;
}

export interface BackendRouteContext<C extends APIContract = APIContract> extends APIEmitter<C> {
  readonly native: BackendNativeClient;
  readonly app: AppContext;
}

export type BackendRouteHandler<
  WebSocketData = unknown,
  Path extends string = string,
  C extends APIContract = APIContract,
> = (
  request: Bun.BunRequest<Path>,
  server: BackendServer<WebSocketData>,
  context: BackendRouteContext<C>,
) => MaybePromise<Response | undefined | void>;

export type BackendRoute<
  WebSocketData = unknown,
  Path extends string = string,
  C extends APIContract = APIContract,
> =
  | BackendRouteHandler<WebSocketData, Path, C>
  | Partial<Record<Bun.Serve.HTTPMethod, BackendRouteHandler<WebSocketData, Path, C>>>;

export interface BackendHTTPDefinition<
  WebSocketData = unknown,
  RoutePaths extends string = string,
  C extends APIContract = APIContract,
> {
  /** Routes are relative to /api: "/stream" is served at /api/stream. Not exposed by the application CLI. */
  readonly routes?: Readonly<{ [Path in RoutePaths]: BackendRoute<WebSocketData, Path, C> }>;
  /** Exact GET paths relative to /api for external browser redirects (e.g. OAuth).
   * No FIA session is required. Handlers MUST validate their own one-use state.
   * Not available through the CLI; wildcard routes and WebSocket upgrades are rejected. */
  readonly callbacks?: Readonly<Record<string, BackendRouteHandler<WebSocketData, string, C>>>;
  /** Fallback receives paths with the /api prefix removed. */
  readonly fetch?: BackendRouteHandler<WebSocketData, string, C>;
  /** Bun server-level options also affect FIA native sockets. Callbacks only receive business sockets. */
  readonly websocket?: Bun.WebSocketHandler<WebSocketData>;
  readonly error?: (error: Error) => MaybePromise<Response | undefined | void>;
  readonly maxRequestBodySize?: number;
  readonly idleTimeout?: number;
}

export interface BackendContext<
  WebSocketData = unknown,
  C extends APIContract = APIContract,
> extends BackendRouteContext<C> {
  readonly server: BackendServer<WebSocketData>;
  url(path?: string): URL;
}

export interface BackendDefinition<
  WebSocketData = unknown,
  RoutePaths extends string = string,
  C extends APIContract = APIContract,
> {
  readonly [FIA_BACKEND]: true;
  readonly api?: APIImplementation<C>;
  readonly apiOptions?: APIOptions;
  readonly beforeUpdate?: (
    context: BackendContext<WebSocketData, C>,
  ) => MaybePromise<{ ready: boolean; reason?: string } | void>;
  readonly http: BackendHTTPDefinition<WebSocketData, RoutePaths, C>;
  readonly start?: (context: BackendContext<WebSocketData, C>) => MaybePromise<void>;
  readonly stop?: (context: BackendContext<WebSocketData, C>) => MaybePromise<void>;
}

interface BackendInput<WebSocketData, RoutePaths extends string, C extends APIContract> {
  readonly api?: APIImplementation<C>;
  readonly apiOptions?: APIOptions;
  readonly beforeUpdate?: (
    context: BackendContext<WebSocketData, C>,
  ) => MaybePromise<{ ready: boolean; reason?: string } | void>;
  readonly http?: BackendHTTPDefinition<WebSocketData, RoutePaths, C>;
  readonly start?: (context: BackendContext<WebSocketData, C>) => MaybePromise<void>;
  readonly stop?: (context: BackendContext<WebSocketData, C>) => MaybePromise<void>;
}

export interface APIOptions {
  /** Per-event-connection queue budget in bytes, at least 1 MiB. Defaults to 4 MiB. */
  eventBufferBytes?: number;
}

export function defineBackend<
  WebSocketData = unknown,
  const RoutePaths extends string = string,
  C extends APIContract = APIContract,
>(
  definition: BackendInput<WebSocketData, RoutePaths, C>,
): BackendDefinition<WebSocketData, RoutePaths, C> {
  if (!isObject(definition) || (definition.http !== undefined && !isObject(definition.http)))
    throw new TypeError("defineBackend expects a backend definition");
  const budget = (definition.apiOptions as APIOptions | undefined)?.eventBufferBytes;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < MAX_FRAME_BYTES))
    throw new TypeError("apiOptions.eventBufferBytes must be a safe integer of at least 1 MiB");
  definition.http ??= {};
  Object.defineProperty(definition, FIA_BACKEND, { value: true, enumerable: false });
  return definition as unknown as BackendDefinition<WebSocketData, RoutePaths, C>;
}

export function isDefinedBackend(value: unknown): value is BackendDefinition {
  return isObject(value) && (value as Partial<BackendDefinition>)[FIA_BACKEND] === true;
}

export interface InitializeFrame {
  readonly v: typeof PROTOCOL;
  readonly type: "initialize";
  readonly sessionSecret: string;
  readonly preferredPort: number;
  readonly development: boolean;
  readonly applicationSupport: string;
  readonly generation: string;
  readonly webRoot: string;
  readonly resourceDirectory: string;
  readonly bundlePath?: string;
  readonly runtimeId?: string;
  readonly agentCommand?: string;
  readonly updating?: boolean;
  readonly developmentOrigin?: string;
  readonly version: string;
  readonly build: number;
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
  api?: APIServer;
  agent?: Awaited<ReturnType<typeof startAgentServer>>;
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
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) throw new Error("stdio frame exceeds 1 MiB");
    }
    if (buffer.length) throw new Error("Truncated stdio frame");
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
          for (const listener of this.listeners.get(frame.event) ?? []) {
            try {
              listener(frame.payload);
            } catch (error) {
              console.error(error);
            }
          }
        } else throw new Error("invalid stdio frame type");
      }
    } catch (error) {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.removeAbort?.();
        pending.reject(error);
      }
      this.pending.clear();
      process.stderr.write(
        `FIA Bun transport failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      runtime()?.server?.stop(true);
      process.exitCode = 1;
    }
  }
}

export class BackendNativeClient extends EventTarget implements NativeTransport {
  private readonly api = createNativeAPI(this);
  readonly application = this.api.application;
  readonly agent = this.api.agent;
  readonly clipboard = this.api.clipboard;
  readonly dialogs = this.api.dialogs;
  readonly keychain = this.api.keychain;
  readonly notifications = this.api.notifications;
  readonly screens = this.api.screens;
  readonly screen = this.api.screen;
  readonly system = this.api.system;
  readonly globalShortcuts = this.api.globalShortcuts;
  readonly windows = this.api.windows;
  readonly resources = this.api.resources;
  readonly updates = this.api.updates;
  constructor(
    private readonly peer: StdioPeer,
    private readonly initialize: InitializeFrame,
  ) {
    super();
  }
  call<Result = unknown>(
    method: string,
    params: unknown = {},
    options?: NativeCallOptions,
  ): Promise<Result> {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(method))
      throw new TypeError("Invalid native method");
    return this.peer.call<Result>(method, params, options);
  }
  on(event: string, listener: (payload: unknown) => void): () => void {
    return this.peer.on(event, listener);
  }
  resource(descriptor: NativeResourceDescriptor): NativeResource {
    const port = runtime()?.server?.port;
    if (!port) throw new Error("Backend has not started");
    return new NativeResource(descriptor, this, {
      url: "http://127.0.0.1:" + port + "/_fia/resources/" + encodeURIComponent(descriptor.id),
      credentials: "omit",
      headers: { "x-fia-session": this.initialize.sessionSecret },
    });
  }
}
function runtime(): Runtime | undefined {
  return (globalThis as typeof globalThis & { [FIA_RUNTIME]?: Runtime })[FIA_RUNTIME];
}
async function shutdown(current: Runtime): Promise<void> {
  if (current.stopping) return;
  current.stopping = true;
  try {
    if (current.context) await current.definition?.stop?.(current.context);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    current.api?.close();
    await current.agent?.stop();
    current.server?.stop(true);
    process.exit(process.exitCode ?? 0);
  }
}
export async function runBackend<Data, Paths extends string>(
  input: BackendDefinition<Data, Paths>,
): Promise<void> {
  const definition = input as unknown as BackendDefinition;
  if (!isDefinedBackend(definition))
    throw new Error("Backend must default-export defineBackend({...})");
  if (runtime()) throw new Error("Only one FIA backend can run in a process");
  const iterator = frames()[Symbol.asyncIterator]();
  const first = await iterator.next();
  const value = first.value;
  if (
    first.done ||
    !value ||
    value.v !== PROTOCOL ||
    value.type !== "initialize" ||
    typeof value.sessionSecret !== "string" ||
    value.sessionSecret.length < 32 ||
    typeof value.generation !== "string" ||
    typeof value.webRoot !== "string" ||
    typeof value.resourceDirectory !== "string" ||
    typeof value.applicationSupport !== "string" ||
    typeof value.preferredPort !== "number" ||
    typeof value.development !== "boolean" ||
    !isObject(value.app)
  ) {
    throw new Error("Expected FIA stdio protocol 5 initialization");
  }
  const initialize = value as unknown as InitializeFrame;
  const peer = new StdioPeer(iterator);
  const native = new BackendNativeClient(peer, initialize);
  const current: Runtime = { initialize, peer, native, definition, stopping: false };
  (globalThis as typeof globalThis & { [FIA_RUNTIME]?: Runtime })[FIA_RUNTIME] = current;
  peer.start();
  peer.on("runtime.shutdown", () => {
    void shutdown(current);
  });
  const app = {
    ...initialize.app,
    dataDirectory: initialize.applicationSupport,
    codeDirectory: initialize.development
      ? process.cwd()
      : resolve(initialize.webRoot, "../backend"),
  };
  const api = new APIServer(
    definition.api ?? { contract: { methods: {}, events: {} }, handlers: {} },
    { native, app },
    definition.apiOptions,
  );
  api.updating = initialize.updating ?? false;
  current.api = api;
  const gateway = createGateway(definition, api.context, initialize, api, async (action) => {
    if (action === "prepare")
      await api.prepare(async () => definition.beforeUpdate?.(current.context!));
    else api.updating = false;
    await current.agent?.publish();
  });
  const serve = (port: number) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: gateway.fetch,
      websocket: gateway.websocket,
      idleTimeout: definition.http.idleTimeout ?? 0,
      maxRequestBodySize: definition.http.maxRequestBodySize ?? 16 * 1024 * 1024,
      error: async (error) =>
        (await definition.http.error?.(error)) ??
        new Response("Internal Server Error", { status: 500 }),
    });
  let server: ReturnType<typeof serve>;
  try {
    server = serve(initialize.preferredPort);
  } catch (error) {
    if (!initialize.preferredPort || (error as NodeJS.ErrnoException).code !== "EADDRINUSE")
      throw error;
    server = serve(0);
  }
  current.server = server;
  const origin = "http://127.0.0.1:" + server.port;
  const context: BackendContext = {
    ...api.context,
    server,
    url: (path = "/") => new URL(path, origin),
  };
  current.context = context;
  // Listening and business readiness are distinct; start hooks may configure native windows.
  writeFrame({ v: PROTOCOL, type: "listening", port: server.port, origin });
  await definition.start?.(context);
  api.ready = true;
  if (initialize.bundlePath && initialize.agentCommand && initialize.runtimeId)
    current.agent = await startAgentServer(api, initialize, () => gateway.issueBrowserURL());
  gateway.ready = true;
  writeFrame({ v: PROTOCOL, type: "ready", port: server.port, origin });
}
export type { TitlebarItem, WindowOptions, UpdateState } from "./api.ts";
