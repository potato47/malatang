import { afterEach, describe, expect, test } from "bun:test";
import { backend, FIA_BACKEND_BRIDGE_VERSION, FIABackendError } from "../src/backend.ts";

interface MutableBridgeGlobal {
  webkit?: {
    messageHandlers: {
      fiaBackend: {
        postMessage(message: unknown): Promise<unknown>;
      };
    };
  };
}

const bridgeGlobal = globalThis as MutableBridgeGlobal;

afterEach(() => {
  delete bridgeGlobal.webkit;
});

function install(responder: (message: unknown) => unknown | Promise<unknown>): unknown[] {
  const messages: unknown[] = [];
  bridgeGlobal.webkit = {
    messageHandlers: {
      fiaBackend: {
        async postMessage(message: unknown): Promise<unknown> {
          messages.push(message);
          return await responder(message);
        },
      },
    },
  };
  return messages;
}

describe("public FIA backend API", () => {
  test("reports unavailable environments and invalid methods", async () => {
    expect(backend.isAvailable()).toBe(false);
    await expect(backend.invoke("hello", {})).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
    await expect(backend.invoke("", {})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("maps generic invocations to the dedicated bridge", async () => {
    const messages = install(() => ({ ok: true, value: { message: "Hello FIA" } }));
    const result = await backend.invoke<{ name: string }, { message: string }>("greet", { name: "FIA" });
    expect(result).toEqual({ message: "Hello FIA" });
    expect(messages).toEqual([{
      version: FIA_BACKEND_BRIDGE_VERSION,
      method: "greet",
      input: { name: "FIA" },
    }]);
  });

  test("preserves structured application errors and rejects malformed replies", async () => {
    install(() => ({
      ok: false,
      error: {
        code: "APPLICATION_ERROR",
        message: "Note not found",
        applicationCode: "NOTE_NOT_FOUND",
        details: { id: 7 },
      },
    }));
    try {
      await backend.invoke("notes.get", { id: 7 });
      throw new Error("expected backend invocation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FIABackendError);
      expect(error).toMatchObject({
        code: "APPLICATION_ERROR",
        applicationCode: "NOTE_NOT_FOUND",
        details: { id: 7 },
      });
    }

    install(() => ({ result: "unexpected" }));
    await expect(backend.invoke("hello")).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
  });

  test("subscribes to named backend events and unsubscribes", () => {
    const payloads: number[] = [];
    const unsubscribe = backend.onEvent<{ progress: number }>("sync.progress", ({ progress }) => {
      payloads.push(progress);
    });
    globalThis.dispatchEvent(new CustomEvent("fia:backend-event", {
      detail: { name: "other", payload: { progress: 1 } },
    }));
    globalThis.dispatchEvent(new CustomEvent("fia:backend-event", {
      detail: { name: "sync.progress", payload: { progress: 50 } },
    }));
    unsubscribe();
    globalThis.dispatchEvent(new CustomEvent("fia:backend-event", {
      detail: { name: "sync.progress", payload: { progress: 100 } },
    }));
    expect(payloads).toEqual([50]);
  });
});
