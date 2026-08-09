import { timingSafeEqual } from "node:crypto";

const FIA_BACKEND = Symbol.for("@semicoder/fia/backend-definition");
const FIA_RUNTIME = Symbol.for("@semicoder/fia/backend-runtime");
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 128;
const REQUEST_TIMEOUT_MS = 30_000;
const BOOTSTRAP_TTL_MS = 30_000;
const COOKIE_NAME = "fia_session";
const RESERVED_PATH_PREFIX = "/_fia/";
const HOST_ERROR_CODES = new Set<FIAHostErrorCode>([
  "INVALID_REQUEST",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "UNSAFE_STATE",
  "NATIVE_FAILURE",
  "PROTOCOL_FAILURE",
  "TIMEOUT",
]);

export type FIAHostErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "UNSAFE_STATE"
  | "NATIVE_FAILURE"
  | "PROTOCOL_FAILURE"
  | "TIMEOUT";

export class FIAHostError extends Error {
  readonly code: FIAHostErrorCode;
  readonly details?: unknown;

  constructor(code: FIAHostErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "FIAHostError";
    this.code = code;
    this.details = details;
  }
}

export interface FIAApplicationState {
  readonly dockVisible: boolean;
  readonly statusItemVisible: boolean;
}

export interface FIAWebViewState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly alwaysOnTop: boolean;
  readonly visibleOnAllSpaces: boolean;
  readonly visibleOverFullScreen: boolean;
}

export interface FIAWebViewOpenOptions {
  id: string;
  url: string;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  closeBehavior?: "hide" | "close";
  restoreFrame?: boolean;
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
  focus?: boolean;
}

export interface FIAWebViewUpdateOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  closeBehavior?: "hide" | "close";
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
}

export type FIAStatusMenuShortcutModifier = "command" | "option" | "control" | "shift";

export interface FIAStatusMenuShortcut {
  key: string;
  modifiers?: readonly FIAStatusMenuShortcutModifier[];
}

export interface FIAStatusMenuSeparator {
  type: "separator";
}

export interface FIAStatusMenuItem {
  type: "item";
  id: string;
  title: string;
  enabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  symbol?: string;
  shortcut?: FIAStatusMenuShortcut;
  children?: readonly FIAStatusMenuNode[];
}

export type FIAStatusMenuNode = FIAStatusMenuSeparator | FIAStatusMenuItem;

export interface FIAStatusMenuItemPatch {
  title?: string;
  enabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  symbol?: string | null;
  shortcut?: FIAStatusMenuShortcut | null;
}

export interface FIAStatusItemClickEvent {
  readonly button: "left";
}

export interface FIAStatusItemActionEvent {
  readonly id: string;
}

export interface FIAWebViewEvent {
  readonly type: "changed" | "closed";
  readonly window: FIAWebViewState;
}

type MaybePromise<Value> = Value | Promise<Value>;
export type FIARouteHandler<WebSocketData = unknown> = (
  request: Bun.BunRequest,
  server: Bun.Server<WebSocketData>,
) => MaybePromise<Response | undefined | void>;

export type FIAProtectedRoute<WebSocketData = unknown> =
  | FIARouteHandler<WebSocketData>
  | Partial<Record<Bun.Serve.HTTPMethod, FIARouteHandler<WebSocketData>>>;

export type FIAPublicRoute = Response | false | Bun.HTMLBundle | Bun.BunFile;

export interface FIAHTTPDefinition<WebSocketData = unknown> {
  publicRoutes?: Readonly<Record<string, FIAPublicRoute>>;
  routes?: Readonly<Record<string, FIAProtectedRoute<WebSocketData>>>;
  fetch?: FIARouteHandler<WebSocketData>;
  websocket?: Bun.WebSocketHandler<WebSocketData>;
  error?: (error: Error) => MaybePromise<Response | undefined | void>;
  maxRequestBodySize?: number;
  idleTimeout?: number;
}

export interface FIABackendContext<WebSocketData = unknown> {
  readonly host: FIAHost;
  readonly server: Bun.Server<WebSocketData>;
  url(path?: string): URL;
}

export interface FIABackendDefinition<WebSocketData = unknown> {
  readonly [FIA_BACKEND]: true;
  readonly http: FIAHTTPDefinition<WebSocketData>;
  readonly start?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
  readonly stop?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
}

export function defineBackend<WebSocketData = unknown>(definition: {
  http: FIAHTTPDefinition<WebSocketData>;
  start?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
  stop?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
}): FIABackendDefinition<WebSocketData> {
  if (!isPlainObject(definition) || !isPlainObject(definition.http)) {
    throw new TypeError("defineBackend expects an object with an http definition");
  }
  Object.defineProperty(definition, FIA_BACKEND, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return definition as FIABackendDefinition<WebSocketData>;
}

export function isDefinedBackend(value: unknown): value is FIABackendDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<FIABackendDefinition>)[FIA_BACKEND] === true
  );
}

interface InitializeFrame {
  readonly v: 1;
  readonly type: "initialize";
  readonly sessionSecret: string;
  readonly preferredPort: number;
  readonly development: boolean;
  readonly applicationSupport: string;
  readonly app: { readonly name: string; readonly identifier: string };
}

interface RequestFrame {
  readonly v: 1;
  readonly type: "request";
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface ResponseFrame {
  readonly v: 1;
  readonly type: "response";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: FIAHostErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

interface EventFrame {
  readonly v: 1;
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
}

type IncomingFrame = InitializeFrame | ResponseFrame | EventFrame;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeFrame(value: unknown): string {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
    throw new FIAHostError("INVALID_ARGUMENT", "The stdio frame exceeds the 1 MiB limit");
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
        if (line.length === 0) throw new FIAHostError("PROTOCOL_FAILURE", "Empty stdio frame");
        if (Buffer.byteLength(line) + 1 > MAX_FRAME_BYTES) {
          throw new FIAHostError("PROTOCOL_FAILURE", "The stdio frame exceeds the 1 MiB limit");
        }
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          throw new FIAHostError("PROTOCOL_FAILURE", "Invalid JSON on stdin");
        }
        yield frame;
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
        throw new FIAHostError("PROTOCOL_FAILURE", "The stdio frame exceeds the 1 MiB limit");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) throw new FIAHostError("PROTOCOL_FAILURE", "Truncated stdio frame");
  } finally {
    reader.releaseLock();
  }
}

class StdioPeer {
  readonly #iterator: AsyncIterator<unknown>;
  readonly #pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
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

  async call<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
    if (this.#closed) throw new FIAHostError("PROTOCOL_FAILURE", "The Host connection is closed");
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      throw new FIAHostError("UNSAFE_STATE", "The Host request concurrency limit was exceeded");
    }
    const id = this.#nextID++;
    const result = new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new FIAHostError("TIMEOUT", `Host request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timer,
      });
    });
    this.write({ v: 1, type: "request", id, method, params } satisfies RequestFrame);
    return await result;
  }

  write(frame: unknown): void {
    process.stdout.write(encodeFrame(frame));
  }

  async #readLoop(): Promise<void> {
    try {
      while (true) {
        const item = await this.#iterator.next();
        if (item.done) throw new FIAHostError("PROTOCOL_FAILURE", "Host stdin closed");
        const frame = item.value as IncomingFrame;
        if (!isPlainObject(frame) || frame.v !== 1 || typeof frame.type !== "string") {
          throw new FIAHostError("PROTOCOL_FAILURE", "Invalid stdio envelope");
        }
        if (frame.type === "response") {
          validateResponseFrame(frame);
          const pending = this.#pending.get(frame.id);
          if (pending === undefined)
            throw new FIAHostError("PROTOCOL_FAILURE", "Unknown response ID");
          this.#pending.delete(frame.id);
          clearTimeout(pending.timer);
          if (frame.error !== undefined) {
            pending.reject(
              new FIAHostError(frame.error.code, frame.error.message, frame.error.details),
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
        throw new FIAHostError("PROTOCOL_FAILURE", `Unexpected stdio frame: ${frame.type}`);
      }
    } catch (error) {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
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

function validateMenu(nodes: readonly FIAStatusMenuNode[]): void {
  const ids = new Set<string>();
  let count = 0;
  const visit = (values: readonly FIAStatusMenuNode[], depth: number): void => {
    if (depth > 8) throw new FIAHostError("INVALID_ARGUMENT", "Status menu exceeds eight levels");
    for (const node of values) {
      count += 1;
      if (count > 256) throw new FIAHostError("INVALID_ARGUMENT", "Status menu exceeds 256 nodes");
      if (node.type === "separator") continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.id) || node.id.startsWith("fia.")) {
        throw new FIAHostError(
          "INVALID_ARGUMENT",
          `Invalid or reserved status menu ID: ${node.id}`,
        );
      }
      if (ids.has(node.id))
        throw new FIAHostError("INVALID_ARGUMENT", `Duplicate status menu ID: ${node.id}`);
      ids.add(node.id);
      if (node.title.length === 0 || node.title.length > 256) {
        throw new FIAHostError(
          "INVALID_ARGUMENT",
          `Invalid title for status menu item: ${node.id}`,
        );
      }
      for (const field of ["enabled", "hidden", "checked"] as const) {
        if (node[field] !== undefined && typeof node[field] !== "boolean") {
          throw new FIAHostError("INVALID_ARGUMENT", `${field} must be a boolean: ${node.id}`);
        }
      }
      if (
        node.symbol !== undefined &&
        (typeof node.symbol !== "string" || node.symbol.length === 0)
      ) {
        throw new FIAHostError("INVALID_ARGUMENT", `Invalid SF Symbol: ${node.id}`);
      }
      if (node.shortcut !== undefined) {
        const modifiers = node.shortcut.modifiers ?? [];
        if (
          typeof node.shortcut.key !== "string" ||
          [...node.shortcut.key].length !== 1 ||
          modifiers.some(
            (modifier) => !(["command", "option", "control", "shift"] as const).includes(modifier),
          )
        ) {
          throw new FIAHostError("INVALID_ARGUMENT", `Invalid shortcut: ${node.id}`);
        }
      }
      if (node.children !== undefined) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 1);
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
    value.v !== 1 ||
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
    throw new FIAHostError("PROTOCOL_FAILURE", "Invalid initialize frame");
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
    value.v !== 1 ||
    value.type !== "response" ||
    !Number.isInteger(value.id) ||
    (value.id as number) <= 0 ||
    hasResult === hasError
  ) {
    throw new FIAHostError("PROTOCOL_FAILURE", "Invalid response frame");
  }
  if (hasError) {
    const error = value.error;
    if (
      !isPlainObject(error) ||
      !hasExactKeys(error, ["code", "message"], ["details"]) ||
      typeof error.code !== "string" ||
      !HOST_ERROR_CODES.has(error.code as FIAHostErrorCode) ||
      typeof error.message !== "string" ||
      error.message.length === 0
    ) {
      throw new FIAHostError("PROTOCOL_FAILURE", "Invalid Host error response");
    }
  }
}

function validateEventFrame(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & EventFrame {
  if (
    !hasExactKeys(value, ["v", "type", "event"], ["payload"]) ||
    value.v !== 1 ||
    value.type !== "event" ||
    typeof value.event !== "string" ||
    value.event.length === 0
  ) {
    throw new FIAHostError("PROTOCOL_FAILURE", "Invalid event frame");
  }
}

export interface FIAHost {
  readonly application: {
    getState(): Promise<FIAApplicationState>;
    quit(): Promise<void>;
    setDockVisible(visible: boolean): Promise<FIAApplicationState>;
  };
  readonly statusItem: {
    setVisible(visible: boolean): Promise<FIAApplicationState>;
    setSymbol(symbol: string): Promise<void>;
    setTooltip(tooltip: string): Promise<void>;
    setMenu(menu: readonly FIAStatusMenuNode[]): Promise<void>;
    updateMenuItem(id: string, patch: FIAStatusMenuItemPatch): Promise<void>;
    onClick(listener: (event: FIAStatusItemClickEvent) => void): () => void;
    onAction(listener: (event: FIAStatusItemActionEvent) => void): () => void;
  };
  readonly webviews: {
    open(options: FIAWebViewOpenOptions): Promise<FIAWebViewState>;
    navigate(id: string, url: string): Promise<FIAWebViewState>;
    show(id: string): Promise<FIAWebViewState>;
    hide(id: string): Promise<FIAWebViewState>;
    focus(id: string): Promise<FIAWebViewState>;
    close(id: string): Promise<void>;
    update(id: string, options: FIAWebViewUpdateOptions): Promise<FIAWebViewState>;
    list(): Promise<readonly FIAWebViewState[]>;
    onEvent(listener: (event: FIAWebViewEvent) => void): () => void;
  };
  readonly system: {
    openURL(url: string): Promise<void>;
  };
}

function eventListener<Value>(
  peer: StdioPeer,
  event: string,
  listener: (value: Value) => void,
): () => void {
  return peer.on(event, (payload) => listener(payload as Value));
}

function createHost(peer: StdioPeer, session: SessionGuard): FIAHost {
  return {
    application: {
      getState: () => peer.call("application.getState"),
      quit: () => peer.call("application.quit"),
      setDockVisible: (visible) => peer.call("application.setDockVisible", { visible }),
    },
    statusItem: {
      setVisible: (visible) => peer.call("statusItem.setVisible", { visible }),
      setSymbol: (symbol) => peer.call("statusItem.setSymbol", { symbol }),
      setTooltip: (tooltip) => peer.call("statusItem.setTooltip", { tooltip }),
      setMenu: async (menu) => {
        validateMenu(menu);
        await peer.call("statusItem.setMenu", { menu });
      },
      updateMenuItem: (id, patch) => peer.call("statusItem.updateMenuItem", { id, patch }),
      onClick: (listener) => eventListener(peer, "statusItem.clicked", listener),
      onAction: (listener) => eventListener(peer, "statusItem.action", listener),
    },
    webviews: {
      open: (options) =>
        peer.call("webviews.open", { ...options, url: session.authorizeURL(options.url) }),
      navigate: (id, url) => peer.call("webviews.navigate", { id, url: session.authorizeURL(url) }),
      show: (id) => peer.call("webviews.show", { id }),
      hide: (id) => peer.call("webviews.hide", { id }),
      focus: (id) => peer.call("webviews.focus", { id }),
      close: (id) => peer.call("webviews.close", { id }),
      update: (id, options) => peer.call("webviews.update", { id, ...options }),
      list: () => peer.call("webviews.list"),
      onEvent: (listener) => eventListener(peer, "webviews.event", listener),
    },
    system: {
      openURL: (url) => peer.call("system.openURL", { url: session.authorizeURL(url) }),
    },
  };
}

function wrapProtectedRoutes<WebSocketData>(
  routes: Readonly<Record<string, FIAProtectedRoute<WebSocketData>>> | undefined,
  authorized: (request: Request) => boolean,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [path, route] of Object.entries(routes ?? {})) {
    if (path.startsWith(RESERVED_PATH_PREFIX)) {
      throw new FIAHostError("INVALID_ARGUMENT", `${RESERVED_PATH_PREFIX} routes are reserved`);
    }
    if (typeof route === "function") {
      output[path] = (request: Bun.BunRequest, server: Bun.Server<WebSocketData>) =>
        authorized(request)
          ? route(request, server)
          : new Response("Unauthorized", { status: 401 });
      continue;
    }
    const methods: Record<string, unknown> = {};
    for (const [method, handler] of Object.entries(route)) {
      if (handler === undefined) continue;
      methods[method] = (request: Bun.BunRequest, server: Bun.Server<WebSocketData>) =>
        authorized(request)
          ? handler(request, server)
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
  server?: Bun.Server<unknown>;
  definition?: FIABackendDefinition;
  context?: FIABackendContext;
  ready: boolean;
  stopping: boolean;
}

function runtimeGlobal(): typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime } {
  return globalThis as typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime };
}

async function sharedRuntime(): Promise<SharedBackendRuntime> {
  const global = runtimeGlobal();
  if (global[FIA_RUNTIME] !== undefined) return global[FIA_RUNTIME];
  const frames = readFrames(Bun.stdin.stream())[Symbol.asyncIterator]();
  const first = await frames.next();
  if (first.done) {
    throw new FIAHostError("PROTOCOL_FAILURE", "The first Host frame must be initialize v1");
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
        if (current.definition !== undefined && current.context !== undefined) {
          await current.definition.stop?.(current.context);
        }
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

export async function runBackend(definition: FIABackendDefinition): Promise<void> {
  if (!isDefinedBackend(definition))
    throw new TypeError("Backend entry must default-export defineBackend({...})");
  const runtime = await sharedRuntime();
  if (runtime.definition !== undefined && runtime.context !== undefined) {
    await runtime.definition.stop?.(runtime.context);
  }
  const { initialize, peer, session } = runtime;
  let port = runtime.server?.port ?? initialize.preferredPort;
  const publicRoutes = definition.http.publicRoutes ?? {};
  for (const path of Object.keys(publicRoutes)) {
    if (path.startsWith(RESERVED_PATH_PREFIX)) {
      throw new FIAHostError("INVALID_ARGUMENT", `${RESERVED_PATH_PREFIX} routes are reserved`);
    }
  }
  const authorize = (request: Request): boolean => session.isAuthorized(request, port);
  const routes: Record<string, unknown> = {
    ...publicRoutes,
    ...wrapProtectedRoutes(definition.http.routes, authorize),
    [`${RESERVED_PATH_PREFIX}bootstrap`]: (request: Request) =>
      session.bootstrap(request, port) ?? new Response("Not Found", { status: 404 }),
    [`${RESERVED_PATH_PREFIX}health`]: new Response(null, { status: 204 }),
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    id: "fia-backend",
    development: initialize.development ? { hmr: true, console: true } : false,
    routes,
    fetch:
      definition.http.fetch === undefined
        ? () => new Response("Not Found", { status: 404 })
        : (request: Request, server: Bun.Server<unknown>) =>
            authorize(request)
              ? definition.http.fetch!(request as Bun.BunRequest, server)
              : new Response("Unauthorized", { status: 401 }),
    ...(definition.http.websocket === undefined ? {} : { websocket: definition.http.websocket }),
    ...(definition.http.error === undefined ? {} : { error: definition.http.error }),
    ...(definition.http.maxRequestBodySize === undefined
      ? {}
      : { maxRequestBodySize: definition.http.maxRequestBodySize }),
    ...(definition.http.idleTimeout === undefined
      ? {}
      : { idleTimeout: definition.http.idleTimeout }),
  } as never) as Bun.Server<unknown>;
  port = server.port ?? 0;
  const origin = `http://127.0.0.1:${port}`;
  session.setOrigin(origin);
  const host = createHost(peer, session);
  const context: FIABackendContext = {
    host,
    server,
    url(path = "/") {
      return new URL(path, origin);
    },
  };
  runtime.server = server;
  runtime.definition = definition;
  runtime.context = context;
  await definition.start?.(context);
  if (!runtime.ready) {
    runtime.ready = true;
    peer.write({ v: 1, type: "ready", port, origin });
  }
}
