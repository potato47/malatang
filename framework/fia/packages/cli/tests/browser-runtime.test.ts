import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { browserRuntime } from "../src/browser-assets.ts";

test("browser transport ends authorization on a stopped backend but preserves caller cancellations", async () => {
  const origin = "http://127.0.0.1:43210";
  const session = { token: "a".repeat(64), generation: "test" };
  let stored: string | null = JSON.stringify(session);
  let notices = 0;
  let stopped = false;
  const location = {
    origin,
    pathname: "/",
    search: "?fiaBrowser=1&fiaGeneration=test",
    href: origin + "/",
  };
  const controller = {
    scriptURL: origin + "/_fia/browser/worker.js?generation=test",
    postMessage(_: unknown, ports: Array<{ postMessage(value: unknown): void }>) {
      ports[0]!.postMessage({ ok: true });
    },
  };
  const window: any = {
    isSecureContext: true,
    fetch: async () => {
      if (stopped) throw new TypeError("Failed to fetch");
      return Response.json({ generation: "test" });
    },
  };
  runInNewContext(browserRuntime, {
    window,
    location,
    URL,
    URLSearchParams,
    Headers,
    setTimeout,
    clearTimeout,
    navigator: { serviceWorker: { controller, register: async () => ({}), addEventListener() {} } },
    sessionStorage: {
      getItem: () => stored,
      setItem: (_: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    },
    MessageChannel: class {
      port1 = { onmessage: undefined as undefined | ((event: any) => void), close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage!({ data }) };
    },
    document: {
      body: {
        append() {
          notices++;
        },
      },
      getElementById: () => undefined,
      createElement: () => ({ style: {}, attachShadow: () => ({}) }),
    },
  });
  const bridge = window.__FIA_BROWSER__;
  await bridge.ready;
  const abort = new AbortController();
  abort.abort();
  stopped = true;
  await expect(bridge.request("/_fia/api/call", { signal: abort.signal })).rejects.toThrow();
  expect(bridge.ended()).toBe(false);
  expect(stored).not.toBeNull();
  let ended = 0;
  bridge.onEnd(() => ended++);
  await expect(bridge.request("/_fia/api/events")).rejects.toThrow();
  expect(bridge.ended()).toBe(true);
  expect(stored).toBeNull();
  expect(notices).toBe(1);
  expect(ended).toBe(1);
  await expect(bridge.request("/_fia/api/events")).rejects.toThrow("authorization ended");
  expect(notices).toBe(1);
});
