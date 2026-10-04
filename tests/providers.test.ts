import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { listProviders, listPresetModels, validatePreset } from "../backend/providers";
import { Models } from "../backend/models";
import { Store, type ModelConfig } from "../backend/store";

const resources: { dir: string; models: Models }[] = [];
afterEach(async () => { for (const { dir, models } of resources.splice(0)) { await models.stop(); await rm(dir, { recursive: true, force: true }); } });
async function setup(fetcher?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), "malatang-providers-"));
  const store = new Store(dir); await store.open();
  const models = new Models(store, () => {}, () => {}, fetcher);
  resources.push({ dir, models }); return { dir, store, models };
}
const input = (preset = "deepseek") => ({ name: "Test model", provider: "ignored for presets", preset, model: listPresetModels(preset)[0]!.id, baseURL: "", apiKey: "test-secret", options: {} as Record<string, string> });
async function waitFor(predicate: () => boolean) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 5000) throw new Error("Timed out"); await Bun.sleep(10); } }
const sse = (events: Record<string, unknown>[], named = false) => events.map(event => `${named ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join("");
const completion = (reason = "stop") => sse([{ choices: [{ index: 0, delta: { role: "assistant", content: "你好" }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: reason }] }]) + "data: [DONE]\n\n";
const anthropic = () => sse([
  { type: "message_start", message: { id: "msg_test", usage: { input_tokens: 2, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
], true);
const responses = () => sse([
  { type: "response.output_item.added", item: { type: "message", id: "msg_test", role: "assistant", status: "in_progress", content: [] } },
  { type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
  { type: "response.output_text.delta", delta: "你好" },
  { type: "response.output_item.done", item: { type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "你好", annotations: [] }] } },
  { type: "response.completed", response: { id: "resp_test", status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } },
]);

test("catalog includes every Pi preset and keeps model-specific protocols/endpoints", () => {
  expect(listProviders().map(p => p.id).sort()).toEqual(builtinProviders().map(p => p.id).sort());
  const router = listPresetModels("openrouter");
  expect(new Set(router.map(model => model.api)).size).toBeGreaterThan(1);
  expect(new Set(router.map(model => model.baseURL)).size).toBeGreaterThan(1);
  for (const provider of listProviders()) {
    expect(listPresetModels(provider.id)).toHaveLength(provider.modelCount);
    expect(Buffer.byteLength(JSON.stringify(listPresetModels(provider.id)))).toBeLessThan(1024 * 1024);
  }
  expect(() => listPresetModels("unknown")).toThrow("未知");
  expect(() => validatePreset("openai-codex", "model", "", {})).toThrow("订阅登录");
  expect(() => validatePreset("typesafe", "model", "", {})).toThrow("预设模型");
});

test("legacy configurations migrate without losing keys or custom endpoints", async () => {
  const { dir, store, models } = await setup();
  const model = await models.save({ name: "Legacy", provider: "Custom", model: "old", baseURL: "https://example.test/v1", apiKey: "legacy-secret" });
  await store.set("translate", "preferences", { modelId: model.id });
  const legacy = structuredClone(store.value) as any;
  delete legacy.models[0].preset; delete legacy.models[0].options;
  await Bun.write(join(dir, "platform.json"), JSON.stringify(legacy));
  const reopened = new Store(dir); await reopened.open();
  expect(reopened.value.models[0]).toMatchObject({ preset: null, options: {}, apiKey: "legacy-secret", baseURL: "https://example.test/v1" });
  expect(reopened.get("translate", "preferences")).toEqual({ modelId: model.id });
});

test("Pi 1.0.2 migrates only known provider aliases and preserves saved identity, credentials and history", async () => {
  const { dir, store } = await setup();
  const cloudflare = ["claude-fable-5.1", "claude-haiku-4.5", "claude-opus-4.5", "claude-opus-4.6", "claude-opus-4.7", "claude-opus-4.8", "claude-opus-5.5", "claude-sonnet-4.5", "claude-sonnet-4.6"];
  const renamed = [...cloudflare.map(model => ({ preset: "cloudflare-ai-gateway", model, next: model.replaceAll(".", "-") })), { preset: "together", model: "deepseek-ai/DeepSeek-V4-Pro", next: "deepseek-ai/DeepSeek-V4-Pro-0813" }];
  await store.update(state => {
    state.models = renamed.map<ModelConfig>(({ preset, model }, index) => {
      const options: Record<string, string> = {};
      if (preset === "cloudflare-ai-gateway") { options.accountId = "account-test"; options.gatewayId = "gateway-test"; }
      return { id: `saved-${index}`, name: `My model ${index}`, provider: listProviders().find(p => p.id === preset)!.name, preset, model, baseURL: "https://proxy.example.test/v1", apiKey: "saved-secret", options };
    });
    const original = state.models[0]!;
    state.models.push(
      { ...original, id: "custom", preset: null },
      { ...original, id: "other-provider", preset: "anthropic" },
      { ...original, id: "subscription", chatgptProfileId: "account" },
      { ...original, id: "unknown-dot-id", model: "claude-unknown-9.9" },
    );
    state.kv = { translate: { preferences: { modelId: "saved-0", target: "English" } } };
    state.runs = [{ id: "history", pluginId: "translate", modelId: "saved-0", input: "old input", output: "old output", title: "history", status: "completed", error: null, createdAt: 1, updatedAt: 2, revision: 1, demo: false }];
  });
  const expected = structuredClone(store.value);
  renamed.forEach((item, index) => {
    expect(listPresetModels(item.preset).some(model => model.id === item.next)).toBe(true);
    expected.models[index]!.model = item.next;
  });
  const reopened = new Store(dir); await reopened.open();
  expect(reopened.value).toEqual(expected);
  expect(await Bun.file(join(dir, "platform.json")).json()).toEqual(expected);
  await reopened.open();
  expect(reopened.value).toEqual(expected);
  expect(await Bun.file(join(dir, "platform.json")).json()).toEqual(expected);
});

for (const [preset, oldModel, nextModel, payload] of [
  ["cloudflare-ai-gateway", "claude-opus-5.5", "claude-opus-5-5", anthropic],
  ["together", "deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Pro-0813", completion],
] as const) test(`restored ${preset} alias sends the new upstream model ID`, async () => {
  let request: Request | undefined;
  const fake = (async (url: string | Request, init?: RequestInit) => { request = new Request(url, init); return new Response(payload(), { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
  const { dir, store } = await setup();
  await store.update(state => { state.models.push({ ...input(preset), id: "saved", model: oldModel, options: preset === "cloudflare-ai-gateway" ? { accountId: "account-test", gatewayId: "gateway-test" } : {} }); });
  const reopened = new Store(dir); await reopened.open();
  const models = new Models(reopened, () => {}, () => {}, fake); resources.push({ dir, models });
  expect(models.list()[0]).toMatchObject({ id: "saved", model: nextModel, configured: true });
  expect(JSON.stringify(models.list())).not.toContain("test-secret");
  const run = await models.start("translate", { modelId: "saved", prompt: "hello" }); await waitFor(() => !models.busy());
  expect(models.get("translate", run.id)).toMatchObject({ status: "completed", output: "你好", error: null });
  expect((await request!.json()).model).toBe(nextModel);
  if (preset === "cloudflare-ai-gateway") {
    expect(request!.url).toContain("/account-test/gateway-test/anthropic/v1/messages");
    expect(request!.headers.get("cf-aig-authorization")).toBe("Bearer test-secret");
  } else expect(request!.headers.get("authorization")).toBe("Bearer test-secret");
});

test("removed catalog entries remain saved, reject generation without a request and can be repaired in place", async () => {
  let fetchCalled = false;
  const { dir, store } = await setup();
  const removed = ["google/gemma-4-31B-it", "openai/gpt-oss-20b"];
  await store.update(state => {
    state.models = removed.map(model => ({ ...input("together"), provider: listProviders().find(p => p.id === "together")!.name, id: model, model }));
    state.models.push({ ...state.models[0]!, id: "missing-key", apiKey: "" }, { ...state.models[0]!, id: "missing-provider", preset: "removed-provider" });
  });
  await store.set("translate", "preferences", { modelId: removed[0]! });
  const before = structuredClone(store.value);
  const reopened = new Store(dir); await reopened.open();
  expect(reopened.value).toEqual(before);
  const models = new Models(reopened, () => {}, () => {}, (async () => { fetchCalled = true; throw new Error("Unexpected request"); }) as unknown as typeof fetch);
  for (const model of models.list()) {
    expect(model.configured).toBe(false);
    expect(model.hasApiKey).toBe(model.id !== "missing-key");
    await expect(models.start("translate", { modelId: model.id, prompt: "hello" })).rejects.toThrow("重新选择模型");
  }
  expect(fetchCalled).toBe(false); expect(reopened.value.runs).toEqual([]);
  const prior = reopened.value.models[0]!;
  const repaired = await models.save({ ...prior, model: "deepseek-ai/DeepSeek-V4-Pro-0813", apiKey: "" });
  expect(repaired).toMatchObject({ id: prior.id, configured: true, hasApiKey: true, model: "deepseek-ai/DeepSeek-V4-Pro-0813" });
  expect(reopened.value.models.find(model => model.id === prior.id)!.apiKey).toBe("test-secret");
  expect(reopened.get("translate", "preferences")).toEqual({ modelId: prior.id });
  expect(reopened.value.models.find(model => model.id === removed[1])).toEqual(before.models[1]);
});

test("edits retain keys only for the same provider/endpoint and allow explicit clearing", async () => {
  const { models, store } = await setup(); const config = input();
  const saved = await models.save(config);
  expect(saved).toMatchObject({ kind: "pi", provider: "DeepSeek", preset: "deepseek", hasApiKey: true });
  expect(JSON.stringify(models.list())).not.toContain(config.apiKey);
  await models.save({ ...config, id: saved.id, apiKey: "", name: "Renamed" });
  expect(store.value.models[0]!.apiKey).toBe(config.apiKey);
  await models.save({ ...config, id: saved.id, apiKey: "", baseURL: "https://proxy.example.test/v1" });
  expect(store.value.models[0]!.apiKey).toBe("");
  await models.save({ ...config, id: saved.id });
  await models.save({ ...input("anthropic"), id: saved.id, apiKey: "" });
  expect(store.value.models[0]!.apiKey).toBe("");
  const cleared = await models.save({ ...config, id: saved.id, clearApiKey: true });
  expect(cleared.hasApiKey).toBe(false);
});

test("preset validation requires cloud routing fields and rejects stale models/options", async () => {
  const { models } = await setup();
  await expect(models.save({ ...input(), model: "unknown-model" })).rejects.toThrow("预设模型");
  await expect(models.save({ ...input(), options: { accountId: "other" } })).rejects.toThrow("选项");
  await expect(models.save(input("cloudflare-ai-gateway"))).rejects.toThrow("Account ID");
  await expect(models.save({ ...input("cloudflare-ai-gateway"), options: { accountId: "../other", gatewayId: "gateway" } })).rejects.toThrow("无效字符");
  await expect(models.save(input("azure-openai-responses"))).rejects.toThrow("API 地址");
  await expect(models.save(input("amazon-bedrock"))).rejects.toThrow("AWS 区域");
  expect((await models.save({ ...input("amazon-bedrock"), options: { region: "us-east-1" } })).options).toEqual({ region: "us-east-1" });
});

for (const [preset, payload, path, authHeader] of [
  ["deepseek", completion, "/chat/completions", "authorization"],
  ["anthropic", anthropic, "/v1/messages", "x-api-key"],
  ["openai", responses, "/v1/responses", "authorization"],
] as const) test(`Pi ${preset} adapter sends its own protocol and completes a host run`, async () => {
  let request: Request | undefined;
  const fake = (async (url: string | Request, init?: RequestInit) => { request = new Request(url, init); return new Response(payload(), { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
  const { models } = await setup(fake); const model = await models.save(input(preset));
  const run = await models.start("translate", { modelId: model.id, prompt: "hello", system: "translate" });
  await waitFor(() => !models.busy());
  expect(models.get("translate", run.id)).toMatchObject({ status: "completed", output: "你好", error: null });
  expect(new URL(request!.url).pathname).toBe(path);
  expect(request!.headers.get(authHeader)).toContain("test-secret");
  const body = await request!.json();
  expect(JSON.stringify(body)).toContain("hello"); expect(JSON.stringify(body)).toContain("translate");
});

test("Cloudflare gateway applies routing options and gateway-only authentication", async () => {
  let request: Request | undefined;
  const fake = (async (url: string | Request, init?: RequestInit) => { request = new Request(url, init); return new Response(anthropic(), { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
  const { models } = await setup(fake);
  const model = await models.save({ ...input("cloudflare-ai-gateway"), options: { accountId: "account-test", gatewayId: "gateway-test" } });
  const run = await models.start("translate", { modelId: model.id, prompt: "hello" }); await waitFor(() => !models.busy());
  expect(models.get("translate", run.id).status).toBe("completed");
  expect(request!.url).toContain("/account-test/gateway-test/anthropic/v1/messages");
  expect(request!.headers.get("cf-aig-authorization")).toBe("Bearer test-secret");
  expect(request!.headers.has("authorization")).toBe(false); expect(request!.headers.has("x-api-key")).toBe(false);
});

test("Pi truncated and output-limited streams preserve partial text and fail", async () => {
  for (const payload of [sse([{ choices: [{ index: 0, delta: { content: "你好" } }] }]), completion("length")]) {
    const { models } = await setup((async () => new Response(payload, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch);
    const model = await models.save(input()); const run = await models.start("translate", { modelId: model.id, prompt: "hello" }); await waitFor(() => !models.busy());
    expect(models.get("translate", run.id)).toMatchObject({ status: "failed", output: "你好" });
  }
});

test("Azure applies resource URL, deployment and API version to Responses requests", async () => {
  let request: Request | undefined;
  const fake = (async (url: string | Request, init?: RequestInit) => { request = new Request(url, init); return new Response(responses(), { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
  const { models } = await setup(fake);
  const model = await models.save({ ...input("azure-openai-responses"), baseURL: "https://test-resource.openai.azure.com", options: { deployment: "my-deployment", apiVersion: "2025-04-01-preview" } });
  const run = await models.start("translate", { modelId: model.id, prompt: "hello" }); await waitFor(() => !models.busy());
  expect(models.get("translate", run.id).status).toBe("completed");
  const url = new URL(request!.url);
  expect(url.hostname).toBe("test-resource.openai.azure.com");
  expect(url.searchParams.get("api-version")).toBe("2025-04-01-preview");
  expect(request!.headers.get("api-key")).toBe("test-secret");
  expect((await request!.json()).model).toBe("my-deployment");
});

test("Pi cancellation aborts upstream and keeps partial output", async () => {
  let upstream: AbortSignal | null = null;
  const fake = (async (_url: unknown, init: RequestInit) => {
    upstream = init.signal!;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse([{ choices: [{ index: 0, delta: { content: "你好" } }] }])));
      init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason), { once: true });
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const { models } = await setup(fake); const model = await models.save(input());
  const run = await models.start("translate", { modelId: model.id, prompt: "hello" });
  await waitFor(() => models.get("translate", run.id).output.length > 0);
  expect(await models.cancel("translate", run.id)).toMatchObject({ status: "cancelled", output: "你好", error: null });
  expect((upstream as unknown as AbortSignal).aborted).toBe(true);
});

test("provider failures cannot persist credentials in run errors", async () => {
  const { models } = await setup((async () => new Response(JSON.stringify({ error: { message: "Invalid test-secret" } }), { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch);
  const model = await models.save(input()); const run = await models.start("translate", { modelId: model.id, prompt: "hello" }); await waitFor(() => !models.busy());
  expect(models.get("translate", run.id).status).toBe("failed");
  expect(models.get("translate", run.id).error).not.toContain("test-secret");
});
