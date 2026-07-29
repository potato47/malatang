import { afterEach, describe, expect, test } from "bun:test";
import {
  FIA_MCP_BRIDGE_VERSION,
  FIA_MCP_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from "../src/mcp.ts";
import { FIANativeError, native, type FIANativeEvent } from "../src/native.ts";

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

describe("typed native MCP facade", () => {
  test("reports an unavailable MCP bridge with a stable error", async () => {
    expect(native.isAvailable()).toBe(false);
    await expect(native.getState()).rejects.toBeInstanceOf(FIANativeError);
    await expect(native.getState()).rejects.toMatchObject({ code: "BRIDGE_UNAVAILABLE" });
  });

  test("keeps typed lifecycle events", () => {
    const events: FIANativeEvent[] = [];
    const unsubscribe = native.onEvent((event) => events.push(event));
    globalThis.dispatchEvent(
      new CustomEvent("fia:native-event", {
        detail: {
          type: "stateChanged",
          state: {
            mode: "dock",
            dockVisible: true,
            statusBarVisible: false,
            statusBarSymbol: "circle.grid.2x2.fill",
            window: {
              visible: true,
              focused: true,
              alwaysOnTop: false,
              visibleOnAllSpaces: false,
              visibleOverFullScreen: false,
            },
          },
        },
      }),
    );
    globalThis.dispatchEvent(
      new CustomEvent("fia:native-event", {
        detail: { type: "statusBarClicked", button: "left" },
      }),
    );
    unsubscribe();
    expect(events.map((event) => event.type)).toEqual(["stateChanged", "statusBarClicked"]);
  });

  test("maps structured Native MCP error codes", async () => {
    bridgeGlobal.webkit = {
      messageHandlers: {
        fiaMcp: {
          async postMessage(raw: unknown): Promise<unknown> {
            const envelope = raw as {
              serverId: string;
              message: JSONRPCMessage & { id?: unknown; method?: string };
            };
            const message =
              envelope.message.method === "server/discover"
                ? {
                    jsonrpc: "2.0",
                    id: envelope.message.id,
                    result: {
                      resultType: "complete",
                      supportedVersions: [FIA_MCP_PROTOCOL_VERSION],
                      capabilities: { tools: { listChanged: false } },
                      _meta: {
                        "io.modelcontextprotocol/serverInfo": {
                          name: "fia.native",
                          version: "0.5.0",
                        },
                      },
                    },
                  }
                : {
                    jsonrpc: "2.0",
                    id: envelope.message.id,
                    error: {
                      code: -32602,
                      message: "invalid native argument",
                      data: { code: "INVALID_ARGUMENT" },
                    },
                  };
            queueMicrotask(() =>
              globalThis.dispatchEvent(
                new CustomEvent("fia:mcp-message", {
                  detail: {
                    bridgeVersion: FIA_MCP_BRIDGE_VERSION,
                    serverId: "fia.native",
                    message,
                  },
                }),
              ),
            );
            return { ok: true };
          },
        },
      },
    };

    await expect(native.getState()).rejects.toMatchObject({
      name: "FIANativeError",
      code: "INVALID_ARGUMENT",
      message: "invalid native argument",
    });
  });
});
