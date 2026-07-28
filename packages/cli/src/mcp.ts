import {
  Client,
  type CallToolRequest,
  type CallToolRequestOptions,
  type CallToolResult,
  type JSONRPCMessage,
  type ListToolsResult,
  type McpSubscription,
  type ReadResourceRequestParams,
  type ReadResourceResult,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/client";

export const FIA_MCP_BRIDGE_VERSION = 1 as const;
export const FIA_MCP_PROTOCOL_VERSION = "2026-07-28" as const;
export const FIA_MCP_MAX_MESSAGE_BYTES = 1024 * 1024;
const MESSAGE_EVENT = "fia:mcp-message";
const STATE_EVENT = "fia:mcp-state";

interface BridgeMessageHandler {
  postMessage(message: unknown): Promise<unknown>;
}

interface BridgeGlobal {
  webkit?: {
    messageHandlers?: {
      fiaMcp?: BridgeMessageHandler;
    };
  };
}

interface BridgeEnvelope {
  bridgeVersion: typeof FIA_MCP_BRIDGE_VERSION;
  serverId: string;
  message: JSONRPCMessage;
}

interface StateEnvelope {
  bridgeVersion: typeof FIA_MCP_BRIDGE_VERSION;
  serverId: string;
  state: "starting" | "connected" | "restarting" | "stopped" | "failed";
  reason?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handler(): BridgeMessageHandler | undefined {
  return (globalThis as BridgeGlobal).webkit?.messageHandlers?.fiaMcp;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateServerId(serverId: string): void {
  if (serverId === "app" || serverId === "fia.native") return;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(serverId)
    || serverId.includes("..")
    || serverId.startsWith("fia.")) {
    throw new TypeError(`Invalid MCP server ID: ${JSON.stringify(serverId)}`);
  }
}

export class FIAWebKitTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  readonly #serverId: string;
  #started = false;
  #closed = false;
  #pendingSends = 0;

  constructor(serverId: string) {
    validateServerId(serverId);
    this.#serverId = serverId;
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error("FIA MCP transport has already started");
    if (handler() === undefined) throw new Error("The FIA MCP bridge is unavailable in this environment");
    this.#started = true;
    globalThis.addEventListener(MESSAGE_EVENT, this.#receiveMessage);
    globalThis.addEventListener(STATE_EVENT, this.#receiveState);
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.#started || this.#closed) throw new Error("The FIA MCP transport is not connected");
    if (this.#pendingSends >= 128) throw new Error("The FIA MCP transport concurrency limit was exceeded");
    const bridge = handler();
    if (bridge === undefined) throw new Error("The FIA MCP bridge is unavailable in this environment");
    const envelope: BridgeEnvelope = {
      bridgeVersion: FIA_MCP_BRIDGE_VERSION,
      serverId: this.#serverId,
      message,
    };
    if (byteLength(envelope) > FIA_MCP_MAX_MESSAGE_BYTES) {
      throw new Error("The FIA MCP message exceeds the 1 MiB limit");
    }
    this.#pendingSends += 1;
    try {
      const response = await bridge.postMessage(envelope);
      if (!isObject(response) || response.ok !== true) {
        const reason = isObject(response) && isObject(response.error) && typeof response.error.message === "string"
          ? response.error.message
          : "The FIA MCP bridge rejected the message";
        throw new Error(reason);
      }
    } finally {
      this.#pendingSends -= 1;
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    globalThis.removeEventListener(MESSAGE_EVENT, this.#receiveMessage);
    globalThis.removeEventListener(STATE_EVENT, this.#receiveState);
    this.onclose?.();
  }

  readonly #receiveMessage = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isObject(detail)
      || detail.bridgeVersion !== FIA_MCP_BRIDGE_VERSION
      || detail.serverId !== this.#serverId
      || !isObject(detail.message)) return;
    if (byteLength(detail) > FIA_MCP_MAX_MESSAGE_BYTES) {
      this.onerror?.(new Error("The FIA MCP server sent a message exceeding the 1 MiB limit"));
      void this.close();
      return;
    }
    this.onmessage?.(detail.message as unknown as JSONRPCMessage);
  };

  readonly #receiveState = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isObject(detail)
      || detail.bridgeVersion !== FIA_MCP_BRIDGE_VERSION
      || detail.serverId !== this.#serverId
      || typeof detail.state !== "string") return;
    const state = detail as unknown as StateEnvelope;
    if (state.state === "failed") {
      this.onerror?.(new Error(state.reason ?? `MCP server ${this.#serverId} failed`));
      void this.close();
    } else if (state.state === "restarting" || state.state === "stopped") {
      void this.close();
    }
  };
}

export interface FIAServerClient {
  client(): Promise<Client>;
  callTool(
    params: CallToolRequest["params"],
    options?: CallToolRequestOptions,
  ): Promise<CallToolResult>;
  listTools(): Promise<ListToolsResult>;
  readResource(params: ReadResourceRequestParams): Promise<ReadResourceResult>;
  subscribeResource(uri: string, listener: FIAResourceUpdatedListener): Promise<() => Promise<void>>;
}

export type FIAResourceUpdatedListener = (update: { readonly uri: string }) => void;

class ServerClient implements FIAServerClient {
  readonly #serverId: string;
  #connection?: Promise<Client>;
  readonly #resourceListeners = new Map<string, Set<FIAResourceUpdatedListener>>();
  readonly #pendingResourceSubscriptions = new Map<string, Promise<void>>();
  readonly #resourceSubscriptions = new Map<string, McpSubscription>();

  constructor(serverId: string) {
    validateServerId(serverId);
    this.#serverId = serverId;
    globalThis.addEventListener(STATE_EVENT, this.#receiveState);
  }

  client(): Promise<Client> {
    this.#connection ??= this.#connect();
    return this.#connection;
  }

  async callTool(
    params: CallToolRequest["params"],
    options: CallToolRequestOptions = {},
  ): Promise<CallToolResult> {
    return await (await this.client()).callTool(params, { timeout: 30_000, ...options });
  }

  async listTools(): Promise<ListToolsResult> {
    return await (await this.client()).listTools(undefined, { timeout: 30_000 });
  }

  async readResource(params: ReadResourceRequestParams): Promise<ReadResourceResult> {
    return await (await this.client()).readResource(params, { timeout: 30_000 });
  }

  async subscribeResource(
    uri: string,
    listener: FIAResourceUpdatedListener,
  ): Promise<() => Promise<void>> {
    if (typeof uri !== "string" || uri.length === 0) {
      throw new TypeError("MCP resource subscription URI must not be empty");
    }
    let listeners = this.#resourceListeners.get(uri);
    if (listeners === undefined) {
      listeners = new Set();
      this.#resourceListeners.set(uri, listeners);
    }
    listeners.add(listener);
    try {
      await this.#ensureResourceSubscription(await this.client(), uri);
    } catch (error) {
      listeners.delete(listener);
      if (listeners.size === 0) this.#resourceListeners.delete(uri);
      throw error;
    }
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      const current = this.#resourceListeners.get(uri);
      current?.delete(listener);
      if (current !== undefined && current.size > 0) return;
      this.#resourceListeners.delete(uri);
      const subscription = this.#resourceSubscriptions.get(uri);
      this.#resourceSubscriptions.delete(uri);
      await subscription?.close().catch(() => undefined);
    };
  }

  async #connect(): Promise<Client> {
    const client = new Client(
      { name: "fia-ui", version: "0.5.0" },
      {
        versionNegotiation: {
          mode: { pin: FIA_MCP_PROTOCOL_VERSION },
          probe: { timeoutMs: 10_000, maxRetries: 0 },
        },
      },
    );
    try {
      await client.connect(new FIAWebKitTransport(this.#serverId), { timeout: 10_000 });
      client.setNotificationHandler("notifications/resources/updated", (notification) => {
        const uri = notification.params.uri;
        for (const listener of this.#resourceListeners.get(uri) ?? []) listener({ uri });
      });
      for (const uri of this.#resourceListeners.keys()) {
        await this.#ensureResourceSubscription(client, uri);
      }
      return client;
    } catch (error) {
      this.#connection = undefined;
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async #ensureResourceSubscription(client: Client, uri: string): Promise<void> {
    if (this.#resourceSubscriptions.has(uri)) return;
    let pending = this.#pendingResourceSubscriptions.get(uri);
    if (pending === undefined) {
      pending = client.listen({ resourceSubscriptions: [uri] }, { timeout: 30_000 })
        .then((subscription) => {
          this.#resourceSubscriptions.set(uri, subscription);
        })
        .finally(() => {
          this.#pendingResourceSubscriptions.delete(uri);
        });
      this.#pendingResourceSubscriptions.set(uri, pending);
    }
    await pending;
  }

  readonly #receiveState = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isObject(detail)
      || detail.bridgeVersion !== FIA_MCP_BRIDGE_VERSION
      || detail.serverId !== this.#serverId
      || (detail.state !== "restarting" && detail.state !== "stopped" && detail.state !== "failed")) return;
    const shouldRestoreSubscriptions = detail.state === "restarting" && this.#resourceListeners.size > 0;
    const old = this.#connection;
    this.#connection = undefined;
    this.#pendingResourceSubscriptions.clear();
    this.#resourceSubscriptions.clear();
    if (old !== undefined) void old.then((client) => client.close()).catch(() => undefined);
    if (shouldRestoreSubscriptions) {
      setTimeout(() => {
        void this.client().catch(() => undefined);
      }, 0);
    }
  };
}

const servers = new Map<string, ServerClient>();

export const mcp = {
  isAvailable(): boolean {
    return handler() !== undefined;
  },

  server(serverId: string): FIAServerClient {
    validateServerId(serverId);
    let server = servers.get(serverId);
    if (server === undefined) {
      server = new ServerClient(serverId);
      servers.set(serverId, server);
    }
    return server;
  },
} as const;

export { Client };
export type {
  CallToolRequest,
  CallToolRequestOptions,
  CallToolResult,
  JSONRPCMessage,
  ListToolsResult,
  ReadResourceRequestParams,
  ReadResourceResult,
  Transport,
};
