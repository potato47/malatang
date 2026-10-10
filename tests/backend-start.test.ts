import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import backend from "../backend";
import { ChatGPTStorage } from "../backend/chatgpt-storage";
import { Store } from "../backend/store";
import type { ChatGPTStatus } from "../shared/chatgpt";

type Context = Parameters<NonNullable<typeof backend.start>>[0];
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "malatang-start-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dataDirectory = join(root, "data");
  const codeDirectory = join(root, "code");
  const plugin = join(codeDirectory, "plugins/translate");
  await Bun.write(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "fixture-translate",
      version: "1.0.0",
      malatang: {
        schemaVersion: 1,
        id: "translate",
        name: "Translate",
        description: "Fixture",
        icon: "T",
        color: "#123456",
        sdkVersion: "0.3",
        frontend: "dist/client.js",
        styles: "dist/client.css",
      },
    }),
  );
  await Bun.write(join(plugin, "dist/client.js"), "export default function Fixture() {}");
  await Bun.write(join(plugin, "dist/client.css"), "");
  let keychainCalls = 0;
  const opened: string[] = [];
  const events: unknown[] = [];
  const native = {
    keychain: new Proxy(
      {},
      {
        get() {
          keychainCalls++;
          throw new Error("Keychain must never be accessed");
        },
      },
    ),
    application: { setAppearance: async () => {} },
    system: {
      openURL: async ({ url }: { url: string }) => {
        opened.push(url);
      },
    },
    windows: { update: async () => {}, setTitlebar: async () => {} },
  };
  const context = {
    app: { dataDirectory, codeDirectory, mode: "development" },
    native,
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload });
    },
    url: (path: string) => new URL(path, "http://127.0.0.1:54873"),
  } as unknown as Context;
  async function call(
    method: keyof NonNullable<typeof backend.api>["contract"]["methods"],
    input: unknown = {},
  ) {
    const api = backend.api!;
    const contract = api.contract.methods[method]!;
    const parsed = contract.input.parse(input);
    const result = await api.handlers[method]!(parsed as never, {
      ...context,
      source: "script",
      requestId: "fixture",
      sessionId: "fixture",
      signal: new AbortController().signal,
    });
    return contract.output.parse(result);
  }
  return {
    dataDirectory,
    context,
    call,
    opened,
    events,
    get keychainCalls() {
      return keychainCalls;
    },
    async start() {
      await backend.start!(context);
      cleanups.unshift(() => Promise.resolve(backend.stop!(context)));
    },
  };
}

test("backend starts and restarts without Keychain; old subscription models stay disconnected and other data survives", async () => {
  const f = await fixture();
  const store = new Store(f.dataDirectory);
  await store.open();
  await store.update((state) => {
    state.theme = "dark";
    state.models = [
      {
        id: "api-model",
        name: "API",
        provider: "Custom",
        model: "test",
        baseURL: "https://example.test/v1",
        apiKey: "retained-api-secret",
        preset: null,
        options: {},
      },
      {
        id: "old-subscription",
        name: "Old subscription",
        provider: "Old account",
        model: "gpt-test",
        baseURL: "https://api.openai.com/v1",
        apiKey: "",
        preset: null,
        options: {},
        chatgptProfileId: "old-keychain-profile",
      },
    ];
    state.kv = { translate: { draft: "keep me", modelId: "old-subscription" } };
    state.runs = [
      {
        id: "history",
        pluginId: "translate",
        modelId: "old-subscription",
        title: "History",
        input: "before",
        output: "saved",
        status: "completed",
        error: null,
        createdAt: 1,
        updatedAt: 2,
        revision: 1,
        demo: false,
      },
    ];
  });
  const before = structuredClone(store.value);
  await f.start();
  expect(await f.call("chatgpt.status")).toMatchObject({
    available: true,
    activeProfileId: null,
    profiles: [],
  });
  expect(await f.call("models.list")).toMatchObject([
    { id: "api-model", configured: true, hasApiKey: true },
    { id: "old-subscription", configured: false, kind: "chatgpt" },
  ]);
  expect(JSON.stringify(await f.call("models.list"))).not.toContain("retained-api-secret");
  expect(await Bun.file(join(f.dataDirectory, "platform.json")).json()).toEqual(before);
  await f.call("chatgpt.signIn");
  const status = (await f.call("chatgpt.status")) as ChatGPTStatus;
  expect(new URL(f.opened[0]!).searchParams.get("client_id")).toBe("dynamic_agent_client");
  await f.call("chatgpt.cancel", { id: status.attempt!.id });
  expect(f.keychainCalls).toBe(0);
  await backend.stop!(f.context);
  await backend.start!(f.context);
  expect(await f.call("chatgpt.status")).toMatchObject({ available: true, profiles: [] });
  expect(await Bun.file(join(f.dataDirectory, "platform.json")).json()).toEqual(before);
  expect(f.keychainCalls).toBe(0);
});

test("backend account edits use only the credential file and expose no tokens or private storage errors", async () => {
  const f = await fixture();
  const storage = new ChatGPTStorage(f.dataDirectory);
  await storage.writeSecret(
    JSON.stringify({
      version: 1,
      hostId: "urn:uuid:fixture",
      activeProfileId: null,
      profiles: [
        {
          id: "file-account",
          clientId: "oaiapp_fixture",
          subject: null,
          email: null,
          label: "File account",
          welcomeSeen: false,
          tokens: null,
        },
      ],
    }),
  );
  await f.start();
  await f.call("chatgpt.rename", { profileId: "file-account", label: "Renamed" });
  await f.call("chatgpt.select", { profileId: "file-account" });
  await f.call("chatgpt.acknowledge", { profileId: "file-account" });
  expect(JSON.parse((await storage.readSecret())!)).toMatchObject({
    activeProfileId: "file-account",
    profiles: [{ label: "Renamed", welcomeSeen: true }],
  });
  await f.call("chatgpt.remove", { profileIds: ["file-account"] });
  expect(JSON.parse((await storage.readSecret())!)).toMatchObject({
    profiles: [],
    activeProfileId: null,
  });
  expect(f.keychainCalls).toBe(0);
  expect(JSON.stringify(f.events)).not.toContain("oaiapp_fixture");
});
