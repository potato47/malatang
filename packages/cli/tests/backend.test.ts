import { describe, expect, test } from "bun:test";
import { BackendNativeClient, defineBackend, isDefinedBackend } from "../src/backend.ts";
import { FIA_BACKEND_PROTOCOL_VERSION } from "../src/metadata.ts";

describe("optional Bun protocol v3 adapter", () => {
  test("brands only valid Backend definitions", () => {
    const definition = defineBackend({ http: { routes: {} } });
    expect(isDefinedBackend(definition)).toBe(true);
    expect(isDefinedBackend({ http: {} })).toBe(false);
    expect(() => (defineBackend as unknown as (...args: unknown[]) => unknown)({})).toThrow();
  });

  test("locks the transport protocol to v3", () => {
    expect(FIA_BACKEND_PROTOCOL_VERSION).toBe(3);
  });

  test("streams and disposes NativeResource through the Bun transport", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const peer = {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params });
      },
      on: () => () => {},
    };
    const session = "s".repeat(64);
    const client = new BackendNativeClient(peer as never, "http://127.0.0.1:45670", session);
    const originalFetch = globalThis.fetch;
    let request: { url: string; session: string | null } | undefined;
    globalThis.fetch = (async (input, init) => {
      request = {
        url: String(input),
        session: new Headers(init?.headers).get("x-fia-session"),
      };
      return new Response("resource payload", { headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    try {
      const resource = client.resource({
        id: "resource-id",
        url: "http://127.0.0.1:45670/_fia/resources/resource-id",
        contentType: "text/plain",
        byteLength: 16,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(await (await resource.blob()).text()).toBe("resource payload");
      expect(request).toEqual({
        url: "http://127.0.0.1:45670/_fia/resources/resource-id",
        session,
      });
      await resource.dispose();
      expect(calls).toEqual([{ method: "resources.dispose", params: { id: "resource-id" } }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
