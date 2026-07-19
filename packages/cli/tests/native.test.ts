import { afterEach, describe, expect, test } from "bun:test";
import {
  FIANativeError,
  FIA_NATIVE_BRIDGE_VERSION,
  native,
  type FIANativeEvent,
  type FIANativeState,
} from "../src/native.ts";

interface MutableBridgeGlobal {
  webkit?: {
    messageHandlers: {
      fiaNative: {
        postMessage(message: unknown): Promise<unknown>;
      };
    };
  };
}

const bridgeGlobal = globalThis as MutableBridgeGlobal;

afterEach(() => {
  delete bridgeGlobal.webkit;
});

function state(overrides: Partial<FIANativeState> = {}): FIANativeState {
  return {
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
    ...overrides,
  };
}

function install(responder: (message: unknown) => unknown | Promise<unknown>): unknown[] {
  const messages: unknown[] = [];
  bridgeGlobal.webkit = {
    messageHandlers: {
      fiaNative: {
        async postMessage(message: unknown): Promise<unknown> {
          messages.push(message);
          return await responder(message);
        },
      },
    },
  };
  return messages;
}

describe("public FIA native API", () => {
  test("reports unavailable environments with a stable error", async () => {
    expect(native.isAvailable()).toBe(false);
    try {
      await native.getState();
      throw new Error("expected native.getState to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FIANativeError);
      expect((error as FIANativeError).code).toBe("BRIDGE_UNAVAILABLE");
    }
  });

  test("maps typed methods to strict bridge commands", async () => {
    const expected = state({ mode: "hybrid", statusBarVisible: true });
    const messages = install(() => ({ ok: true, value: expected }));
    expect(native.isAvailable()).toBe(true);
    expect(await native.getState()).toEqual(expected);
    await native.app.showDock();
    await native.window.setAlwaysOnTop(true);
    await native.statusBar.setIcon("bolt.fill");
    expect(messages).toEqual([
      { version: FIA_NATIVE_BRIDGE_VERSION, command: "native.getState", params: {} },
      { version: FIA_NATIVE_BRIDGE_VERSION, command: "app.showDock", params: {} },
      { version: FIA_NATIVE_BRIDGE_VERSION, command: "window.setAlwaysOnTop", params: { enabled: true } },
      { version: FIA_NATIVE_BRIDGE_VERSION, command: "statusBar.setIcon", params: { symbol: "bolt.fill" } },
    ]);
  });

  test("decodes structured errors and rejects malformed responses", async () => {
    install(() => ({ ok: false, error: { code: "UNSAFE_STATE", message: "Keep a recovery entry" } }));
    await expect(native.app.hideDock()).rejects.toMatchObject({ code: "UNSAFE_STATE" });

    install(() => ({ result: "unexpected" }));
    await expect(native.getState()).rejects.toMatchObject({ code: "NATIVE_FAILURE" });
  });

  test("subscribes to typed events and unsubscribes", () => {
    const events: FIANativeEvent[] = [];
    const unsubscribe = native.onEvent((event) => events.push(event));
    globalThis.dispatchEvent(new CustomEvent("fia:native-event", {
      detail: { type: "stateChanged", state: state() },
    }));
    globalThis.dispatchEvent(new CustomEvent("fia:native-event", {
      detail: { type: "statusBarClicked", button: "left" },
    }));
    unsubscribe();
    globalThis.dispatchEvent(new CustomEvent("fia:native-event", {
      detail: { type: "statusBarClicked", button: "left" },
    }));
    expect(events.map((event) => event.type)).toEqual(["stateChanged", "statusBarClicked"]);
  });
});
