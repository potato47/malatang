import { afterEach, describe, expect, test } from "bun:test";
import {
  FIA_MCP_BRIDGE_VERSION,
  FIA_MCP_PROTOCOL_VERSION,
  FIAWebKitTransport,
  mcp,
  type JSONRPCMessage,
} from "../src/mcp.ts";
import { McpServer, defineMcpServer, isDefinedMcpServer } from "../src/mcp-server.ts";

interface MutableBridgeGlobal {
  webkit?: {
    messageHandlers?: {
      fiaMcp?: { postMessage(message: unknown): Promise<unknown> };
    };
  };
}

const bridgeGlobal = globalThis as MutableBridgeGlobal;

afterEach(() => {
  delete bridgeGlobal.webkit;
});

function response(id: unknown, result: Record<string, unknown>, serverId = "app"): void {
  queueMicrotask(() =>
    globalThis.dispatchEvent(
      new CustomEvent("fia:mcp-message", {
        detail: {
          bridgeVersion: FIA_MCP_BRIDGE_VERSION,
          serverId,
          message: { jsonrpc: "2.0", id, result },
        },
      }),
    ),
  );
}

describe("FIA MCP public APIs", () => {
  test("marks only synchronous defineMcpServer factories", () => {
    const factory = defineMcpServer(() => new McpServer({ name: "app", version: "0.1.0" }));
    expect(isDefinedMcpServer(factory)).toBe(true);
    expect(isDefinedMcpServer(() => undefined)).toBe(false);
  });

  test("pins modern discovery and preserves MCP JSON-RPC inside the bridge envelope", async () => {
    const messages: Array<{ serverId: string; message: JSONRPCMessage }> = [];
    bridgeGlobal.webkit = {
      messageHandlers: {
        fiaMcp: {
          async postMessage(raw: unknown): Promise<unknown> {
            const envelope = raw as {
              bridgeVersion: number;
              serverId: string;
              message: JSONRPCMessage & { id?: unknown; method?: string };
            };
            messages.push({ serverId: envelope.serverId, message: envelope.message });
            if (envelope.message.method === "server/discover") {
              response(envelope.message.id, {
                resultType: "complete",
                supportedVersions: [FIA_MCP_PROTOCOL_VERSION],
                capabilities: { tools: { listChanged: false } },
                _meta: {
                  "io.modelcontextprotocol/serverInfo": { name: "app", version: "0.1.0" },
                },
              });
            } else if (envelope.message.method === "tools/call") {
              response(envelope.message.id, {
                resultType: "complete",
                content: [{ type: "text", text: "Hello, FIA!" }],
                structuredContent: { message: "Hello, FIA!" },
                _meta: {
                  "io.modelcontextprotocol/serverInfo": { name: "app", version: "0.1.0" },
                },
              });
            }
            return { ok: true };
          },
        },
      },
    };

    const result = await mcp.server("app").callTool({ name: "greet", arguments: { name: "FIA" } });
    expect(result.structuredContent).toEqual({ message: "Hello, FIA!" });
    expect(messages.map(({ serverId }) => serverId)).toEqual(["app", "app"]);
    expect(messages[0]?.message).toMatchObject({
      jsonrpc: "2.0",
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": FIA_MCP_PROTOCOL_VERSION,
        },
      },
    });
  });

  test("rejects reserved external IDs", () => {
    expect(() => mcp.server("fia.external")).toThrow("Invalid MCP server ID");
    expect(() => mcp.server("../unsafe")).toThrow("Invalid MCP server ID");
  });

  test("restores facade resource subscriptions after a development restart", async () => {
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const subscriptionIDs: unknown[] = [];
    const updates: string[] = [];
    bridgeGlobal.webkit = {
      messageHandlers: {
        fiaMcp: {
          async postMessage(raw: unknown): Promise<unknown> {
            const envelope = raw as {
              serverId: string;
              message: JSONRPCMessage & { id?: unknown; method?: string };
            };
            const meta = {
              "io.modelcontextprotocol/serverInfo": { name: "search", version: "0.1.0" },
            };
            if (envelope.message.method === "server/discover") {
              response(
                envelope.message.id,
                {
                  resultType: "complete",
                  supportedVersions: [FIA_MCP_PROTOCOL_VERSION],
                  capabilities: { resources: { subscribe: true, listChanged: false } },
                  _meta: meta,
                },
                "search",
              );
            } else if (envelope.message.method === "subscriptions/listen") {
              subscribeCalls += 1;
              subscriptionIDs.push(envelope.message.id);
              queueMicrotask(() =>
                globalThis.dispatchEvent(
                  new CustomEvent("fia:mcp-message", {
                    detail: {
                      bridgeVersion: FIA_MCP_BRIDGE_VERSION,
                      serverId: "search",
                      message: {
                        jsonrpc: "2.0",
                        method: "notifications/subscriptions/acknowledged",
                        params: {
                          _meta: {
                            "io.modelcontextprotocol/subscriptionId": envelope.message.id,
                          },
                          notifications: { resourceSubscriptions: ["fia://search/state"] },
                        },
                      },
                    },
                  }),
                ),
              );
            } else if (envelope.message.method === "notifications/cancelled") {
              unsubscribeCalls += 1;
            }
            return { ok: true };
          },
        },
      },
    };

    const server = mcp.server("search");
    const unsubscribe = await server.subscribeResource("fia://search/state", ({ uri }) =>
      updates.push(uri),
    );
    expect(subscribeCalls).toBe(1);
    globalThis.dispatchEvent(
      new CustomEvent("fia:mcp-message", {
        detail: {
          bridgeVersion: FIA_MCP_BRIDGE_VERSION,
          serverId: "search",
          message: {
            jsonrpc: "2.0",
            method: "notifications/resources/updated",
            params: {
              _meta: {
                "io.modelcontextprotocol/subscriptionId": subscriptionIDs[0],
              },
              uri: "fia://search/state",
            },
          },
        },
      }),
    );
    await Bun.sleep(0);
    expect(updates).toEqual(["fia://search/state"]);

    globalThis.dispatchEvent(
      new CustomEvent("fia:mcp-state", {
        detail: {
          bridgeVersion: FIA_MCP_BRIDGE_VERSION,
          serverId: "search",
          state: "restarting",
        },
      }),
    );
    for (let attempt = 0; attempt < 100 && subscribeCalls < 2; attempt += 1) {
      await Bun.sleep(5);
    }
    expect(subscribeCalls).toBe(2);
    await unsubscribe();
    expect(unsubscribeCalls).toBe(1);
  });

  test("enforces transport concurrency and client call timeouts", async () => {
    let releaseBridge!: () => void;
    const bridgeGate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    bridgeGlobal.webkit = {
      messageHandlers: {
        fiaMcp: {
          async postMessage(): Promise<unknown> {
            await bridgeGate;
            return { ok: true };
          },
        },
      },
    };
    const transport = new FIAWebKitTransport("parallel");
    await transport.start();
    const notification = {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "test" },
    } as JSONRPCMessage;
    const pending = Array.from({ length: 128 }, () => transport.send(notification));
    await expect(transport.send(notification)).rejects.toThrow("concurrency limit");
    releaseBridge();
    await Promise.all(pending);
    await transport.close();

    bridgeGlobal.webkit = {
      messageHandlers: {
        fiaMcp: {
          async postMessage(raw: unknown): Promise<unknown> {
            const envelope = raw as {
              message: JSONRPCMessage & { id?: unknown; method?: string };
            };
            if (envelope.message.method === "server/discover") {
              response(
                envelope.message.id,
                {
                  resultType: "complete",
                  supportedVersions: [FIA_MCP_PROTOCOL_VERSION],
                  capabilities: { tools: { listChanged: false } },
                  _meta: {
                    "io.modelcontextprotocol/serverInfo": { name: "slow", version: "0.1.0" },
                  },
                },
                "slow",
              );
            }
            return { ok: true };
          },
        },
      },
    };
    await expect(
      mcp.server("slow").callTool({ name: "never-returns", arguments: {} }, { timeout: 5 }),
    ).rejects.toThrow();
  });
});
