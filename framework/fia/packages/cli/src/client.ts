import { browserBridge, frontendFetch, openWebSocket } from "./browser-transport.ts";
export { openWebSocket } from "./browser-transport.ts";
import { createNativeAPI } from "./api.ts";
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
  readonly protocolVersion: number;
  readonly capabilities: Readonly<Record<string, boolean>>;
  /** Explicit native method allowlist when connected from a browser. */
  readonly methods?: readonly string[];
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
    return await frontendFetch(this.#request.url, {
      credentials: this.#request.credentials,
      ...(this.#request.headers === undefined ? {} : { headers: this.#request.headers }),
    });
  }
}

export class NativeClient extends EventTarget implements NativeTransport {
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
  #socket?: WebSocket;
  #reconnect?: ReturnType<typeof setTimeout>;
  #closed = false;
  #listeners = 0;

  /** Call after the first UI mount (included in the generated template). */
  async ready(): Promise<void> {
    const query = new URLSearchParams(window.location.search);
    const response = await frontendFetch("/_fia/ready", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        windowId: query.get("fiaWindow") ?? "main",
        generation: query.get("fiaGeneration"),
        ...(query.get("fiaBrowser") === "1" ? { browser: true } : {}),
      }),
    });
    if (!response.ok) throw new Error("FIA frontend readiness was rejected");
  }

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
    this.#closed = false;
    const socket = await this.#connect();
    if (options.signal?.aborted) throw options.signal.reason;
    if (this.#pending.size >= 128) throw new Error("Native request concurrency limit exceeded");
    const id = this.#nextID++;
    const message = JSON.stringify({ v: 1, type: "request", id, method, params });
    if (new TextEncoder().encode(message).byteLength > 1024 * 1024)
      throw new Error("Native request exceeds protocol limit");
    const cancel = () => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ v: 1, type: "cancel", id }));
    };
    return await new Promise<Result>((resolve, reject) => {
      const pending: PendingCall = {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
      };
      const timeout = options.timeoutMs ?? 30_000;
      if (timeout > 0) {
        pending.timer = setTimeout(() => {
          this.#settle(id, () => {});
          cancel();
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
          cancel();
        };
        options.signal.addEventListener("abort", abort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", abort);
      }
      this.#pending.set(id, pending);
      try {
        socket.send(message);
      } catch (error) {
        this.#settle(id, () => reject(error));
      }
    });
  }

  capabilities(options?: NativeCallOptions): Promise<NativeCapabilities> {
    return this.call("native.capabilities", {}, options);
  }

  on(event: string, listener: (payload: unknown) => void): () => void {
    const handler = (message: Event): void => listener((message as CustomEvent<unknown>).detail);
    this.#closed = false;
    this.#listeners++;
    this.addEventListener(event, handler);
    void this.#connect().catch(() => {});
    let active = true;
    return () => {
      if (active) {
        active = false;
        this.#listeners--;
        this.removeEventListener(event, handler);
      }
    };
  }

  resource(descriptor: NativeResourceDescriptor): NativeResource {
    return new NativeResource(descriptor, this, {
      url: `/_fia/resources/${encodeURIComponent(descriptor.id)}`,
      credentials: "same-origin",
    });
  }

  close(): void {
    this.#closed = true;
    clearTimeout(this.#reconnect);
    this.#socket?.close(1000, "client closed");
    this.#socket = undefined;
    this.#connecting = undefined;
    for (const id of this.#pending.keys())
      this.#settle(id, (pending) => pending.reject(new Error("Native client closed")));
  }

  async #connect(): Promise<WebSocket> {
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    if (this.#connecting !== undefined) return await this.#connecting;
    this.#connecting = openWebSocket("/_fia/native")
      .then(
        (socket) =>
          new Promise<WebSocket>((resolve, reject) => {
            this.#socket = socket;
            const timeout = setTimeout(() => {
              socket.close();
              reject(new Error("Native connection timed out"));
            }, 5000);
            socket.addEventListener(
              "open",
              () => {
                clearTimeout(timeout);
                if (this.#socket !== socket || this.#closed) {
                  socket.close();
                  reject(new Error("Native client closed"));
                  return;
                }
                this.#connecting = undefined;
                resolve(socket);
              },
              { once: true },
            );
            socket.addEventListener(
              "error",
              () => {
                clearTimeout(timeout);
                if (this.#socket === socket) this.#connecting = undefined;
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
            socket.addEventListener("message", (event) => {
              if (this.#socket === socket) this.#receive(event.data);
            });
            socket.addEventListener("close", () => {
              clearTimeout(timeout);
              reject(new Error("Native connection closed"));
              if (this.#socket !== socket) return;
              this.#socket = undefined;
              this.#connecting = undefined;
              if (!this.#closed && !browserBridge()?.ended() && this.#listeners > 0)
                this.#reconnect = setTimeout(() => {
                  void this.#connect().catch(() => {});
                }, 500);
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
          }),
      )
      .catch((error) => {
        this.#connecting = undefined;
        throw error;
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

export type { TitlebarItem, WindowOptions, UpdateState } from "./api.ts";

export { createClient, APIError } from "./api-client.ts";
export type { APIClient, CallOptions } from "./business-api.ts";
