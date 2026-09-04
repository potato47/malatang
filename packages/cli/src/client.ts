export type NativeErrorCode =
  | "invalid_request"
  | "invalid_argument"
  | "not_found"
  | "unsafe_state"
  | "native_failure"
  | "protocol_failure"
  | "timeout"
  | "cancelled"
  | "conflict"
  | "permission_denied"
  | "capability_unavailable"
  | "resource_limit"
  | (string & {});

export interface NativeErrorPayload {
  readonly code: NativeErrorCode;
  readonly component: string;
  readonly method?: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: unknown;
}

export class NativeError extends Error {
  readonly code: NativeErrorCode;
  readonly component: string;
  readonly method?: string;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(payload: NativeErrorPayload) {
    super(payload.message);
    this.name = "NativeError";
    this.code = payload.code;
    this.component = payload.component;
    this.method = payload.method;
    this.recoverable = payload.recoverable;
    this.details = payload.details;
  }
}

export interface NativeCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface NativeTransport {
  call<Result = unknown>(
    method: string,
    params?: unknown,
    options?: NativeCallOptions,
  ): Promise<Result>;
  on(event: string, listener: (payload: unknown) => void): () => void;
}

export interface NativeCapabilities {
  readonly mode: "application" | "browserCompanion";
  readonly protocolVersion: number;
  readonly capabilities: Readonly<Record<string, boolean>>;
}

export interface NativeResourceDescriptor {
  readonly id: string;
  readonly url: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly expiresAt: string;
}

interface ResponseFrame {
  readonly v: 1;
  readonly type: "response";
  readonly id: number;
  readonly result?: unknown;
  readonly error?: NativeErrorPayload;
}

interface EventFrame {
  readonly v: 1;
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
}

interface PendingCall {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
}

function nativeWebSocketURL(): URL {
  if (typeof window === "undefined")
    throw new NativeError({
      code: "capability_unavailable",
      component: "client",
      message: "The browser Native client requires a Window environment",
      recoverable: false,
    });
  const url = new URL("/_fia/native", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

export class NativeResource {
  readonly id: string;
  readonly mimeType: string;
  readonly size: number;
  readonly expiresAt: Date;
  #disposed = false;
  readonly #transport: NativeTransport;
  readonly #request: {
    readonly url: string;
    readonly credentials: RequestCredentials;
    readonly headers?: Readonly<Record<string, string>>;
  };

  constructor(
    descriptor: NativeResourceDescriptor,
    transport: NativeTransport,
    request: {
      readonly url: string;
      readonly credentials: RequestCredentials;
      readonly headers?: Readonly<Record<string, string>>;
    },
  ) {
    this.id = descriptor.id;
    this.mimeType = descriptor.contentType;
    this.size = descriptor.byteLength;
    this.expiresAt = new Date(descriptor.expiresAt);
    this.#transport = transport;
    this.#request = request;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async blob(): Promise<Blob> {
    this.#assertAvailable();
    const response = await this.#fetch();
    if (!response.ok)
      throw new NativeError({
        code: response.status === 404 ? "not_found" : "native_failure",
        component: "resource",
        message: `Could not read native resource ${this.id}`,
        recoverable: response.status >= 500,
      });
    return await response.blob();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return await (await this.blob()).arrayBuffer();
  }

  async stream(): Promise<ReadableStream<Uint8Array>> {
    this.#assertAvailable();
    const response = await this.#fetch();
    if (!response.ok || response.body === null)
      throw new NativeError({
        code: response.status === 404 ? "not_found" : "native_failure",
        component: "resource",
        message: `Could not stream native resource ${this.id}`,
        recoverable: response.status >= 500,
      });
    return response.body;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    await this.#transport.call("resources.dispose", { id: this.id });
    this.#disposed = true;
  }

  #assertAvailable(): void {
    if (this.#disposed)
      throw new NativeError({
        code: "unsafe_state",
        component: "resource",
        message: `Native resource ${this.id} was disposed`,
        recoverable: false,
      });
  }

  async #fetch(): Promise<Response> {
    return await fetch(this.#request.url, {
      credentials: this.#request.credentials,
      ...(this.#request.headers === undefined ? {} : { headers: this.#request.headers }),
    });
  }
}

export class NativeClient extends EventTarget implements NativeTransport {
  #socket?: WebSocket;
  #connecting?: Promise<WebSocket>;
  #nextID = 1;
  readonly #pending = new Map<number, PendingCall>();

  async call<Result = unknown>(
    method: string,
    params: unknown = {},
    options: NativeCallOptions = {},
  ): Promise<Result> {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(method)) {
      throw new NativeError({
        code: "invalid_argument",
        component: "client",
        method,
        message: "Native method name is invalid",
        recoverable: false,
      });
    }
    if (options.signal?.aborted === true) throw options.signal.reason;
    const socket = await this.#connect();
    const id = this.#nextID++;
    return await new Promise<Result>((resolve, reject) => {
      const pending: PendingCall = {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
      };
      const timeout = options.timeoutMs ?? 30_000;
      if (timeout > 0) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          socket.send(JSON.stringify({ v: 1, type: "cancel", id }));
          reject(
            new NativeError({
              code: "timeout",
              component: "client",
              method,
              message: `Native method timed out after ${timeout} ms`,
              recoverable: true,
            }),
          );
        }, timeout);
      }
      if (options.signal !== undefined) {
        const abort = (): void => {
          this.#settle(id, () =>
            reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          );
          socket.send(JSON.stringify({ v: 1, type: "cancel", id }));
        };
        options.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", abort);
      }
      this.#pending.set(id, pending);
      socket.send(JSON.stringify({ v: 1, type: "request", id, method, params }));
    });
  }

  capabilities(options?: NativeCallOptions): Promise<NativeCapabilities> {
    return this.call("native.capabilities", {}, options);
  }

  on(event: string, listener: (payload: unknown) => void): () => void {
    const handler = (message: Event): void => listener((message as CustomEvent<unknown>).detail);
    this.addEventListener(event, handler);
    return () => this.removeEventListener(event, handler);
  }

  resource(descriptor: NativeResourceDescriptor): NativeResource {
    return new NativeResource(descriptor, this, {
      url: `/_fia/resources/${encodeURIComponent(descriptor.id)}`,
      credentials: "same-origin",
    });
  }

  close(): void {
    this.#socket?.close(1000, "client closed");
    this.#socket = undefined;
    this.#connecting = undefined;
  }

  async #connect(): Promise<WebSocket> {
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    if (this.#connecting !== undefined) return await this.#connecting;
    this.#connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(nativeWebSocketURL());
      socket.addEventListener(
        "open",
        () => {
          this.#socket = socket;
          this.#connecting = undefined;
          resolve(socket);
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          this.#connecting = undefined;
          reject(
            new NativeError({
              code: "native_failure",
              component: "client",
              message: "Could not connect to the FIA Native Runtime",
              recoverable: true,
            }),
          );
        },
        { once: true },
      );
      socket.addEventListener("message", (event) => this.#receive(event.data));
      socket.addEventListener("close", () => {
        if (this.#socket === socket) this.#socket = undefined;
        for (const id of this.#pending.keys()) {
          this.#settle(id, (pending) =>
            pending.reject(
              new NativeError({
                code: "native_failure",
                component: "client",
                method: pending.method,
                message: "The FIA Native Runtime disconnected",
                recoverable: true,
              }),
            ),
          );
        }
      });
    });
    return await this.#connecting;
  }

  #receive(value: unknown): void {
    if (typeof value !== "string") return;
    let frame: ResponseFrame | EventFrame;
    try {
      frame = JSON.parse(value) as ResponseFrame | EventFrame;
    } catch {
      return;
    }
    if (frame.v !== 1) return;
    if (frame.type === "event") {
      this.dispatchEvent(new CustomEvent(frame.event, { detail: frame.payload }));
      return;
    }
    const pending = this.#pending.get(frame.id);
    if (pending === undefined) return;
    this.#settle(frame.id, () => {
      if (frame.error !== undefined) pending.reject(new NativeError(frame.error));
      else pending.resolve(frame.result);
    });
  }

  #settle(id: number, action: (pending: PendingCall) => void): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    pending.removeAbort?.();
    action(pending);
  }
}

export const native = new NativeClient();
