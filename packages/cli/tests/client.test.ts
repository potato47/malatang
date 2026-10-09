import { expect, test } from "bun:test";
import { NativeClient, type NativeCallOptions } from "../src/client.ts";
import { createNativeAPI } from "../src/api.ts";

test("keychain and file dialogs have no default deadline but honor explicit cancellation and timeout options", async () => {
  const calls: { method: string; options?: NativeCallOptions }[] = [];
  const api = createNativeAPI({
    on: () => () => {},
    async call<Result>(
      method: string,
      _params: unknown,
      options?: NativeCallOptions,
    ): Promise<Result> {
      calls.push({ method, options });
      return null as Result;
    },
  });
  await api.keychain.get({ key: "test" });
  await api.keychain.set({ key: "test", value: "fixture" });
  await api.keychain.delete({ key: "test" });
  await api.dialogs.openFiles({ multiple: false });
  await api.dialogs.saveFile({ suggestedName: "test.txt" });
  expect(calls.map((call) => call.options?.timeoutMs)).toEqual([0, 0, 0, 0, 0]);
  const controller = new AbortController();
  await api.keychain.get({ key: "test" }, { timeoutMs: 50, signal: controller.signal });
  expect(calls.at(-1)?.options).toEqual({ timeoutMs: 50, signal: controller.signal });
  await api.dialogs.openFiles({ multiple: false }, { timeoutMs: 50, signal: controller.signal });
  expect(calls.at(-1)?.options).toEqual({ timeoutMs: 50, signal: controller.signal });
  await api.dialogs.saveFile({}, { timeoutMs: 50, signal: controller.signal });
  expect(calls.at(-1)?.options).toEqual({ timeoutMs: 50, signal: controller.signal });
});

test("late socket events cannot settle requests from a replacement connection", async () => {
  const originalSocket = globalThis.WebSocket;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  class Socket extends EventTarget {
    static OPEN = 1;
    static all: Socket[] = [];
    readyState = 0;
    sent: string[] = [];
    constructor(_url: URL) {
      super();
      Socket.all.push(this);
    }
    send(value: string) {
      if (this.readyState !== 1) throw new Error("Closed socket");
      this.sent.push(value);
    }
    close() {
      this.readyState = 3;
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    }
    reply(id: number, result: unknown) {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ v: 1, type: "response", id, result }),
        }),
      );
    }
  }
  Object.defineProperty(globalThis, "window", {
    value: { location: { href: "http://127.0.0.1:1234/", origin: "http://127.0.0.1:1234" } },
    configurable: true,
  });
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const client = new NativeClient();
  try {
    const first = client.call("echo").catch((error) => error);
    const previous = Socket.all[0]!;
    await Bun.sleep(0);
    previous.open();
    await Bun.sleep(0);
    client.close();
    expect(await first).toBeInstanceOf(Error);
    const next = client.call("echo");
    const active = Socket.all[1]!;
    await Bun.sleep(0);
    active.open();
    await Bun.sleep(0);
    previous.dispatchEvent(new Event("close"));
    const request = JSON.parse(active.sent[0]!);
    previous.reply(request.id, "stale");
    active.reply(request.id, "current");
    expect(await next).toBe("current");
    const controller = new AbortController();
    const cancelled = client
      .call("slow", {}, { signal: controller.signal })
      .catch((error) => error);
    await Bun.sleep(0);
    controller.abort(new Error("Cancelled by caller"));
    expect(((await cancelled) as Error).message).toBe("Cancelled by caller");
    expect(JSON.parse(active.sent.at(-1)!).type).toBe("cancel");
  } finally {
    client.close();
    for (const socket of Socket.all) socket.dispatchEvent(new Event("close"));
    globalThis.WebSocket = originalSocket;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
