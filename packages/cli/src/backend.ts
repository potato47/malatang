import { timingSafeEqual } from "node:crypto";

const FIA_BACKEND = Symbol.for("@semicoder/fia/backend-definition");
const FIA_RUNTIME = Symbol.for("@semicoder/fia/backend-runtime");
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 128;
const REQUEST_TIMEOUT_MS = 30_000;
const STDIO_PROTOCOL_VERSION = 2 as const;
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
  "CANCELLED",
]);

export type FIAHostErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "UNSAFE_STATE"
  | "NATIVE_FAILURE"
  | "PROTOCOL_FAILURE"
  | "TIMEOUT"
  | "CANCELLED";

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

export type FIAWebViewWindowStyle = "native" | "borderless";

export interface FIAWebViewDragRegion {
  height: number;
  leftInset?: number;
  rightInset?: number;
}

export interface FIAWebViewFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FIAWebViewState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly windowStyle: FIAWebViewWindowStyle;
  readonly transparent: boolean;
  readonly shadow: boolean;
  readonly resizable: boolean;
  readonly dragRegion: FIAWebViewDragRegion | null;
  readonly frame: FIAWebViewFrame;
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
  x?: number;
  y?: number;
  windowStyle?: FIAWebViewWindowStyle;
  transparent?: boolean;
  shadow?: boolean;
  resizable?: boolean;
  dragRegion?: FIAWebViewDragRegion;
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
  x?: number;
  y?: number;
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

export interface FIAHostCallOptions {
  readonly signal?: AbortSignal;
}

export type FIANotificationAuthorizationStatus =
  | "notDetermined"
  | "denied"
  | "authorized"
  | "provisional"
  | "ephemeral"
  | "unknown";

export interface FIANotificationSendOptions {
  id?: string;
  title: string;
  subtitle?: string;
  body?: string;
  sound?: boolean;
}

export interface FIANotificationReceipt {
  readonly id: string;
}

export interface FIANotificationClickEvent {
  readonly id: string;
}

export interface FIAFileDialogOptions {
  title?: string;
  directory?: string;
  showHiddenFiles?: boolean;
}

export interface FIAOpenFileDialogOptions extends FIAFileDialogOptions {
  allowedExtensions?: readonly string[];
  multiple?: boolean;
}

export interface FIAOpenDirectoryDialogOptions extends FIAFileDialogOptions {
  multiple?: boolean;
}

export interface FIASaveFileDialogOptions extends FIAFileDialogOptions {
  allowedExtensions?: readonly string[];
  name?: string;
  canCreateDirectories?: boolean;
}

type MaybePromise<Value> = Value | Promise<Value>;
export type FIAServer<WebSocketData = unknown> = Bun.Server<WebSocketData>;

export interface FIAAppContext {
  readonly name: string;
  readonly identifier: string;
  readonly dataDirectory: string;
}

export interface FIARouteContext {
  readonly host: FIAHost;
  readonly app: FIAAppContext;
}

export type FIARouteHandler<WebSocketData = unknown, Path extends string = string> = (
  request: Bun.BunRequest<Path>,
  server: FIAServer<WebSocketData>,
  context: FIARouteContext,
) => MaybePromise<Response | undefined | void>;

export type FIAProtectedRoute<WebSocketData = unknown, Path extends string = string> =
  | FIARouteHandler<WebSocketData, Path>
  | Partial<Record<Bun.Serve.HTTPMethod, FIARouteHandler<WebSocketData, Path>>>;

export type FIAPublicRoute = Response | false | Bun.HTMLBundle | Bun.BunFile;

export interface FIAHTTPDefinition<WebSocketData = unknown, RoutePaths extends string = string> {
  publicRoutes?: Readonly<Record<string, FIAPublicRoute>>;
  routes?: Readonly<{
    [Path in RoutePaths]: FIAProtectedRoute<WebSocketData, Path>;
  }>;
  fetch?: FIARouteHandler<WebSocketData>;
  websocket?: Bun.WebSocketHandler<WebSocketData>;
  error?: (error: Error) => MaybePromise<Response | undefined | void>;
  maxRequestBodySize?: number;
  idleTimeout?: number;
}

export interface FIABackendContext<WebSocketData = unknown> extends FIARouteContext {
  readonly server: FIAServer<WebSocketData>;
  url(path?: string): URL;
}

export interface FIABackendDefinition<WebSocketData = unknown, RoutePaths extends string = string> {
  readonly [FIA_BACKEND]: true;
  readonly http: FIAHTTPDefinition<WebSocketData, RoutePaths>;
  readonly start?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
  readonly stop?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
}

interface FIABackendInput<WebSocketData, RoutePaths extends string> {
  http: FIAHTTPDefinition<WebSocketData, RoutePaths>;
  start?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
  stop?: (context: FIABackendContext<WebSocketData>) => MaybePromise<void>;
}

export function defineBackend<WebSocketData = unknown>(): <const RoutePaths extends string>(
  definition: FIABackendInput<WebSocketData, RoutePaths>,
) => FIABackendDefinition<WebSocketData, RoutePaths>;
export function defineBackend<WebSocketData = unknown>(...unexpected: never[]) {
  if (unexpected.length !== 0) {
    throw new TypeError(
      "defineBackend now uses defineBackend<SocketData>()({...}) or defineBackend()({...})",
    );
  }
  return <const RoutePaths extends string>(
    definition: FIABackendInput<WebSocketData, RoutePaths>,
  ): FIABackendDefinition<WebSocketData, RoutePaths> => {
    if (!isPlainObject(definition) || !isPlainObject(definition.http)) {
      throw new TypeError("defineBackend expects an object with an http definition");
    }
    Object.defineProperty(definition, FIA_BACKEND, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return definition as unknown as FIABackendDefinition<WebSocketData, RoutePaths>;
  };
}

export function isDefinedBackend(value: unknown): value is FIABackendDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<FIABackendDefinition>)[FIA_BACKEND] === true
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
    readonly code: FIAHostErrorCode;
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

interface StdioCallOptions extends FIAHostCallOptions {
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
    if (this.#closed) throw new FIAHostError("PROTOCOL_FAILURE", "The Host connection is closed");
    if (options.signal?.aborted === true)
      throw new DOMException("The Host request was aborted", "AbortError");
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      throw new FIAHostError("UNSAFE_STATE", "The Host request concurrency limit was exceeded");
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
        () => retire(new FIAHostError("TIMEOUT", `Host request timed out: ${method}`)),
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
        if (item.done) throw new FIAHostError("PROTOCOL_FAILURE", "Host stdin closed");
        const frame = item.value as IncomingFrame;
        if (
          !isPlainObject(frame) ||
          frame.v !== STDIO_PROTOCOL_VERSION ||
          typeof frame.type !== "string"
        ) {
          throw new FIAHostError("PROTOCOL_FAILURE", "Invalid stdio envelope");
        }
        if (frame.type === "response") {
          validateResponseFrame(frame);
          const pending = this.#pending.get(frame.id);
          if (pending === undefined)
            throw new FIAHostError("PROTOCOL_FAILURE", "Unknown response ID");
          this.#pending.delete(frame.id);
          if (pending.timer !== undefined) clearTimeout(pending.timer);
          pending.removeAbortListener?.();
          if (pending.retired) continue;
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
    value.v !== STDIO_PROTOCOL_VERSION ||
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
    value.v !== STDIO_PROTOCOL_VERSION ||
    value.type !== "event" ||
    typeof value.event !== "string" ||
    value.event.length === 0
  ) {
    throw new FIAHostError("PROTOCOL_FAILURE", "Invalid event frame");
  }
}

export interface FIAHost {
  readonly application: {
    getState(callOptions?: FIAHostCallOptions): Promise<FIAApplicationState>;
    quit(callOptions?: FIAHostCallOptions): Promise<void>;
    setDockVisible(
      visible: boolean,
      callOptions?: FIAHostCallOptions,
    ): Promise<FIAApplicationState>;
  };
  readonly statusItem: {
    setVisible(visible: boolean, callOptions?: FIAHostCallOptions): Promise<FIAApplicationState>;
    setSymbol(symbol: string, callOptions?: FIAHostCallOptions): Promise<void>;
    setTooltip(tooltip: string, callOptions?: FIAHostCallOptions): Promise<void>;
    setMenu(menu: readonly FIAStatusMenuNode[], callOptions?: FIAHostCallOptions): Promise<void>;
    updateMenuItem(
      id: string,
      patch: FIAStatusMenuItemPatch,
      callOptions?: FIAHostCallOptions,
    ): Promise<void>;
    onClick(listener: (event: FIAStatusItemClickEvent) => void): () => void;
    onAction(listener: (event: FIAStatusItemActionEvent) => void): () => void;
  };
  readonly webviews: {
    open(
      options: FIAWebViewOpenOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<FIAWebViewState>;
    navigate(id: string, url: string, callOptions?: FIAHostCallOptions): Promise<FIAWebViewState>;
    show(id: string, callOptions?: FIAHostCallOptions): Promise<FIAWebViewState>;
    hide(id: string, callOptions?: FIAHostCallOptions): Promise<FIAWebViewState>;
    focus(id: string, callOptions?: FIAHostCallOptions): Promise<FIAWebViewState>;
    close(id: string, callOptions?: FIAHostCallOptions): Promise<void>;
    update(
      id: string,
      options: FIAWebViewUpdateOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<FIAWebViewState>;
    list(callOptions?: FIAHostCallOptions): Promise<readonly FIAWebViewState[]>;
    onEvent(listener: (event: FIAWebViewEvent) => void): () => void;
  };
  readonly system: {
    openURL(url: string, callOptions?: FIAHostCallOptions): Promise<void>;
  };
  readonly notifications: {
    getAuthorizationStatus(
      callOptions?: FIAHostCallOptions,
    ): Promise<FIANotificationAuthorizationStatus>;
    requestAuthorization(
      callOptions?: FIAHostCallOptions,
    ): Promise<FIANotificationAuthorizationStatus>;
    send(
      options: FIANotificationSendOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<FIANotificationReceipt>;
    remove(id: string, callOptions?: FIAHostCallOptions): Promise<void>;
    removeAll(callOptions?: FIAHostCallOptions): Promise<void>;
    onClick(listener: (event: FIANotificationClickEvent) => void): () => void;
  };
  readonly dialogs: {
    openFile(
      options?: FIAOpenFileDialogOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<readonly string[] | null>;
    openDirectory(
      options?: FIAOpenDirectoryDialogOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<readonly string[] | null>;
    saveFile(
      options?: FIASaveFileDialogOptions,
      callOptions?: FIAHostCallOptions,
    ): Promise<string | null>;
  };
  readonly clipboard: {
    readText(callOptions?: FIAHostCallOptions): Promise<string | null>;
    writeText(text: string, callOptions?: FIAHostCallOptions): Promise<void>;
    clear(callOptions?: FIAHostCallOptions): Promise<void>;
  };
  readonly keychain: {
    get(key: string, callOptions?: FIAHostCallOptions): Promise<string | null>;
    set(key: string, value: string, callOptions?: FIAHostCallOptions): Promise<void>;
    delete(key: string, callOptions?: FIAHostCallOptions): Promise<boolean>;
  };
}

function eventListener<Value>(
  peer: StdioPeer,
  event: string,
  listener: (value: Value) => void,
  scope: HostEventScope,
): () => void {
  return scope.add(peer.on(event, (payload) => listener(payload as Value)));
}

class HostEventScope {
  readonly #removers = new Set<() => void>();
  #disposed = false;

  add(remove: () => void): () => void {
    if (this.#disposed) {
      remove();
      return () => {};
    }
    let active = true;
    const scopedRemove = (): void => {
      if (!active) return;
      active = false;
      this.#removers.delete(scopedRemove);
      remove();
    };
    this.#removers.add(scopedRemove);
    return scopedRemove;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const remove of this.#removers) remove();
  }
}

function createHost(peer: StdioPeer, session: SessionGuard, events: HostEventScope): FIAHost {
  return {
    application: {
      getState: (callOptions) => peer.call("application.getState", {}, callOptions),
      quit: (callOptions) => peer.call("application.quit", {}, callOptions),
      setDockVisible: (visible, callOptions) =>
        peer.call("application.setDockVisible", { visible }, callOptions),
    },
    statusItem: {
      setVisible: (visible, callOptions) =>
        peer.call("statusItem.setVisible", { visible }, callOptions),
      setSymbol: (symbol, callOptions) =>
        peer.call("statusItem.setSymbol", { symbol }, callOptions),
      setTooltip: (tooltip, callOptions) =>
        peer.call("statusItem.setTooltip", { tooltip }, callOptions),
      setMenu: async (menu, callOptions) => {
        validateMenu(menu);
        await peer.call("statusItem.setMenu", { menu }, callOptions);
      },
      updateMenuItem: (id, patch, callOptions) =>
        peer.call("statusItem.updateMenuItem", { id, patch }, callOptions),
      onClick: (listener) => eventListener(peer, "statusItem.clicked", listener, events),
      onAction: (listener) => eventListener(peer, "statusItem.action", listener, events),
    },
    webviews: {
      open: (options, callOptions) =>
        peer.call(
          "webviews.open",
          { ...options, url: session.authorizeURL(options.url) },
          callOptions,
        ),
      navigate: (id, url, callOptions) =>
        peer.call("webviews.navigate", { id, url: session.authorizeURL(url) }, callOptions),
      show: (id, callOptions) => peer.call("webviews.show", { id }, callOptions),
      hide: (id, callOptions) => peer.call("webviews.hide", { id }, callOptions),
      focus: (id, callOptions) => peer.call("webviews.focus", { id }, callOptions),
      close: (id, callOptions) => peer.call("webviews.close", { id }, callOptions),
      update: (id, options, callOptions) =>
        peer.call("webviews.update", { id, ...options }, callOptions),
      list: (callOptions) => peer.call("webviews.list", {}, callOptions),
      onEvent: (listener) => eventListener(peer, "webviews.event", listener, events),
    },
    system: {
      openURL: (url, callOptions) =>
        peer.call("system.openURL", { url: session.authorizeURL(url) }, callOptions),
    },
    notifications: {
      getAuthorizationStatus: (callOptions) =>
        peer.call("notifications.getAuthorizationStatus", {}, callOptions),
      requestAuthorization: (callOptions) =>
        peer.call("notifications.requestAuthorization", {}, { ...callOptions, timeout: false }),
      send: (options, callOptions) => peer.call("notifications.send", { ...options }, callOptions),
      remove: (id, callOptions) => peer.call("notifications.remove", { id }, callOptions),
      removeAll: (callOptions) => peer.call("notifications.removeAll", {}, callOptions),
      onClick: (listener) => eventListener(peer, "notifications.clicked", listener, events),
    },
    dialogs: {
      openFile: (options = {}, callOptions) =>
        peer.call("dialogs.openFile", { ...options }, { ...callOptions, timeout: false }),
      openDirectory: (options = {}, callOptions) =>
        peer.call("dialogs.openDirectory", { ...options }, { ...callOptions, timeout: false }),
      saveFile: (options = {}, callOptions) =>
        peer.call("dialogs.saveFile", { ...options }, { ...callOptions, timeout: false }),
    },
    clipboard: {
      readText: (callOptions) => peer.call("clipboard.readText", {}, callOptions),
      writeText: (text, callOptions) => peer.call("clipboard.writeText", { text }, callOptions),
      clear: (callOptions) => peer.call("clipboard.clear", {}, callOptions),
    },
    keychain: {
      get: (key, callOptions) => peer.call("keychain.get", { key }, callOptions),
      set: (key, value, callOptions) => peer.call("keychain.set", { key, value }, callOptions),
      delete: (key, callOptions) => peer.call("keychain.delete", { key }, callOptions),
    },
  };
}

function wrapProtectedRoutes<WebSocketData, RoutePaths extends string>(
  routes:
    | Readonly<{
        [Path in RoutePaths]: FIAProtectedRoute<WebSocketData, Path>;
      }>
    | undefined,
  authorized: (request: Request) => boolean,
  context: FIARouteContext,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [path, route] of Object.entries(routes ?? {})) {
    if (path.startsWith(RESERVED_PATH_PREFIX)) {
      throw new FIAHostError("INVALID_ARGUMENT", `${RESERVED_PATH_PREFIX} routes are reserved`);
    }
    if (typeof route === "function") {
      output[path] = (request: Bun.BunRequest, server: FIAServer<WebSocketData>) =>
        authorized(request)
          ? route(request as never, server, context)
          : new Response("Unauthorized", { status: 401 });
      continue;
    }
    const methods: Record<string, unknown> = {};
    const routeMethods = route as unknown as Partial<
      Record<Bun.Serve.HTTPMethod, FIARouteHandler<WebSocketData>>
    >;
    for (const [method, handler] of Object.entries(routeMethods)) {
      if (handler === undefined) continue;
      methods[method] = (request: Bun.BunRequest, server: FIAServer<WebSocketData>) =>
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
  server?: FIAServer<unknown>;
  definition?: FIABackendDefinition;
  context?: FIABackendContext;
  hostEvents?: HostEventScope;
  ready: boolean;
  stopping: boolean;
}

function runtimeGlobal(): typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime } {
  return globalThis as typeof globalThis & { [FIA_RUNTIME]?: SharedBackendRuntime };
}

async function deactivateDefinition(runtime: SharedBackendRuntime): Promise<void> {
  const definition = runtime.definition;
  const context = runtime.context;
  const hostEvents = runtime.hostEvents;
  runtime.definition = undefined;
  runtime.context = undefined;
  runtime.hostEvents = undefined;
  try {
    if (definition !== undefined && context !== undefined) await definition.stop?.(context);
  } finally {
    hostEvents?.dispose();
  }
}

async function sharedRuntime(): Promise<SharedBackendRuntime> {
  const global = runtimeGlobal();
  if (global[FIA_RUNTIME] !== undefined) return global[FIA_RUNTIME];
  const frames = readFrames(Bun.stdin.stream())[Symbol.asyncIterator]();
  const first = await frames.next();
  if (first.done) {
    throw new FIAHostError("PROTOCOL_FAILURE", "The first Host frame must be initialize v2");
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
        await deactivateDefinition(current);
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
    throw new TypeError("Backend entry must default-export defineBackend()({...})");
  const runtime = await sharedRuntime();
  await deactivateDefinition(runtime);
  const { initialize, peer, session } = runtime;
  const hostEvents = new HostEventScope();
  const host = createHost(peer, session, hostEvents);
  const routeContext: FIARouteContext = {
    host,
    app: {
      name: initialize.app.name,
      identifier: initialize.app.identifier,
      dataDirectory: initialize.applicationSupport,
    },
  };
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
    ...wrapProtectedRoutes(definition.http.routes, authorize, routeContext),
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
        : (request: Request, server: FIAServer<unknown>) =>
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
  } as never) as FIAServer<unknown>;
  port = server.port ?? 0;
  const origin = `http://127.0.0.1:${port}`;
  session.setOrigin(origin);
  const context: FIABackendContext = {
    ...routeContext,
    server,
    url(path = "/") {
      return new URL(path, origin);
    },
  };
  runtime.server = server;
  runtime.definition = definition;
  runtime.context = context;
  runtime.hostEvents = hostEvents;
  await definition.start?.(context);
  if (!runtime.ready) {
    if (initialize.development && process.env.FIA_INTERNAL_PRINT_SESSION_URL === "1") {
      process.stderr.write(`FIA_DEV_SESSION_URL=${session.authorizeURL(context.url("/").href)}\n`);
    }
    runtime.ready = true;
    peer.write({ v: STDIO_PROTOCOL_VERSION, type: "ready", port, origin });
  }
}
