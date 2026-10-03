import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../backend/store";
import { DEMO_TEXT, Models, readSSE } from "../backend/models";
import { Plugins, containedFile, manifestSchema } from "../backend/plugins";
const directories: string[] = [];
const runners: Models[] = [];
afterEach(async () => { for (const model of runners.splice(0)) await model.stop(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup(fetcher?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), "malatang-test-")); directories.push(dir);
  const store = new Store(dir); await store.open();
  const models = new Models(store, () => {}, () => {}, fetcher); runners.push(models);
  return { store, models, dir };
}
async function waitFor(predicate: () => boolean, ms = 5000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > ms) throw new Error("Timed out"); await Bun.sleep(15); } }
test("KV serializes concurrent writes, isolates plugins, handles prototype keys and persists", async () => {
  const { store, dir } = await setup();
  await Promise.all([store.set("a", "note", "alpha"), store.set("b", "note", "beta"), store.set("__proto__", "constructor", { safe: true })]);
  expect(store.get("a", "note")).toBe("alpha"); expect(store.get("b", "note")).toBe("beta");
  expect(store.get("missing", "constructor")).toBeNull();
  expect(store.get("__proto__", "constructor")).toEqual({ safe: true });
  const restored = new Store(dir); await restored.open(); expect(restored.get("a", "note")).toBe("alpha");
  await expect(store.set("a", "huge", "x".repeat(65537))).rejects.toThrow("64 KiB");
});
test("SSE parser handles byte-split Chinese and CRLF frames", async () => {
  const bytes = new TextEncoder().encode('data: {"text":"你好"}\r\n\r\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const frames: string[] = []; for await (const frame of readSSE(stream)) frames.push(frame);
  expect(frames).toEqual(['{"text":"你好"}', '[DONE]']);
});
test("real provider path sends system/user messages and redacts credentials", async () => {
  let requested: RequestInit | undefined;
  const fake = (async (_url: unknown, init: RequestInit) => { requested = init; return new Response('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); }) as typeof fetch;
  const { models, store } = await setup(fake);
  const model = await models.save({ name: "test", provider: "test", model: "test-model", baseURL: "https://example.test/v1", apiKey: "test-secret" });
  expect(JSON.stringify(models.list())).not.toContain("test-secret");
  const run = await models.start("translate", { modelId: model.id, prompt: "hello", system: "translate" });
  await waitFor(() => !models.busy());
  expect(models.get("translate", run.id).output).toBe("你好");
  expect(models.get("translate", run.id).status).toBe("completed");
  expect(JSON.parse(requested!.body as string).messages).toEqual([{ role: "system", content: "translate" }, { role: "user", content: "hello" }]);
  expect(store.value.runs[0]?.status).toBe("completed");
});
test("truncated provider stream fails rather than marking partial text complete", async () => {
  const { models } = await setup((async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')) as unknown as typeof fetch);
  const model = await models.save({ name: "test", provider: "test", model: "test", baseURL: "http://localhost:1234/v1" });
  const run = await models.start("translate", { modelId: model.id, prompt: "hello" }); await waitFor(() => !models.busy());
  expect(models.get("translate", run.id).status).toBe("failed"); expect(models.get("translate", run.id).output).toBe("partial");
});
test("demo cancellation retains partial state and blocks other plugin access", async () => {
  const { models } = await setup();
  const run = await models.start("translate", { modelId: "demo", prompt: DEMO_TEXT });
  await waitFor(() => models.get("translate", run.id).output.length > 0);
  const stopped = await models.cancel("translate", run.id); expect(stopped.status).toBe("cancelled"); expect(stopped.output.length).toBeGreaterThan(0);
  expect(() => models.get("other", run.id)).toThrow("不存在");
});
test("restart marks unfinished runs interrupted", async () => {
  const { store, models, dir } = await setup();
  const run = await models.start("translate", { modelId: "demo", prompt: DEMO_TEXT });
  const restored = new Store(dir); await restored.open(); expect(restored.value.runs[0]?.status).toBe("failed");
  await models.cancel("translate", run.id);
});
test("manifest rejects incompatible SDK and resource traversal / symlinks", async () => {
  const { dir } = await setup();
  await mkdir(join(dir, "package")); await Bun.write(join(dir, "outside.js"), "export default 1"); await symlink(join(dir, "outside.js"), join(dir, "package", "escape.js"));
  await expect(containedFile(join(dir, "package"), "../outside.js")).rejects.toThrow();
  await expect(containedFile(join(dir, "package"), "escape.js")).rejects.toThrow();
  const pkg = await Bun.file("plugins/translate/package.json").json(); expect(manifestSchema.safeParse({ ...pkg.malatang, sdkVersion: "9.0" }).success).toBe(false);
});
test("page retention is opt-in and is included in discovery for old and invalid packages", async () => {
  const pkg = await Bun.file("plugins/translate/package.json").json();
  const { keepAlive: _keepAlive, backend: _backend, ...legacy } = pkg.malatang;
  expect(manifestSchema.parse(legacy).keepAlive).toBe(false);
  expect(manifestSchema.parse({ ...legacy, keepAlive: false }).keepAlive).toBe(false);
  expect(manifestSchema.parse({ ...legacy, keepAlive: true }).keepAlive).toBe(true);
  for (const value of ["true", 1, null]) expect(manifestSchema.safeParse({ ...legacy, keepAlive: value }).success).toBe(false);

  const { store, models, dir } = await setup();
  const root = join(dir, "code");
  const plugin = join(root, "plugins/translate");
  await mkdir(join(plugin, "dist"), { recursive: true });
  await Bun.write(join(plugin, "package.json"), JSON.stringify({ name: "legacy-plugin", version: "0.1.0", malatang: legacy }));
  await Bun.write(join(plugin, "dist/client.js"), "export default function Page() {}");
  await store.update(state => { state.plugins.push({ id: "missing-package", root: join(dir, "missing"), installation: "missing", source: "test" }); });
  const plugins = new Plugins(store, models, root, () => {});
  await plugins.open();
  expect(plugins.list().find(item => item.id === "translate")?.keepAlive).toBe(false);
  expect(plugins.list().find(item => item.id === "missing-package")?.keepAlive).toBe(false);
  await plugins.stop();
});
test("independent built-in backend invokes SDK and gates disable while active", async () => {
  const { store, models } = await setup(); const plugins = new Plugins(store, models, resolve("."), () => {}); await plugins.open();
  expect(plugins.list()[0]?.methods[0]?.name).toBe("translate");
  expect(plugins.list()[0]?.keepAlive).toBe(true);
  const result = await plugins.invoke("translate", "translate", { text: DEMO_TEXT, target: "简体中文", modelId: "demo" }) as { id: string };
  await expect(plugins.setEnabled("translate", false)).rejects.toThrow("正在运行");
  await models.cancel("translate", result.id); expect((await plugins.setEnabled("translate", false)).status).toBe("disabled");
  await expect(plugins.invoke("translate", "translate", {})).rejects.toThrow("停用");
  expect((await plugins.setEnabled("translate", true)).status).toBe("active"); await plugins.stop();
});
test("local archive installs, reloads, retains KV after uninstall and reports duplicate error", async () => {
  const { store, models } = await setup(); const plugins = new Plugins(store, models, resolve("."), () => {}); await plugins.open();
  const job = plugins.installExample(); await waitFor(() => plugins.listJobs()[0]?.status !== "installing", 15000);
  expect(plugins.listJobs()[0]?.status).toBe("completed"); expect(plugins.list().find(item => item.id === "quick-notes")?.builtin).toBe(false);
  expect(plugins.list().find(item => item.id === "quick-notes")?.keepAlive).toBe(true);
  await store.set("quick-notes", "note", "persist");
  plugins.installExample(); await waitFor(() => plugins.listJobs()[0]?.status !== "installing", 15000); expect(plugins.listJobs()[0]?.status).toBe("failed");
  const restored = new Plugins(store, models, resolve("."), () => {}); await restored.open(); expect(restored.list().find(item => item.id === "quick-notes")?.status).toBe("active");
  await plugins.uninstall("quick-notes"); expect(store.get("quick-notes", "note")).toBe("persist"); expect(plugins.list().length).toBe(1);
  await plugins.stop(); await restored.stop();
});

test("theme defaults on existing data, persists across restarts and keeps plugin data", async () => {
  const { store, dir } = await setup();
  await store.set("translate", "preferences", { target: "English" });
  const { theme: _theme, ...legacy } = store.value;
  await Bun.write(join(dir, "platform.json"), JSON.stringify(legacy));
  const migrated = new Store(dir); await migrated.open();
  expect(migrated.value.theme).toBe("system");
  await migrated.update(state => { state.theme = "dark"; });
  const reopened = new Store(dir); await reopened.open();
  expect(reopened.value.theme).toBe("dark");
  expect(reopened.get("translate", "preferences")).toEqual({ target: "English" });
});

test("theme changes serialize native application and persistence; native failures leave preference unchanged", async () => {
  const { Appearance } = await import("../backend/appearance");
  const { store } = await setup();
  const applied: string[] = [];
  const events: string[] = [];
  const appearance = new Appearance(store, async theme => { if (theme === "dark") await Bun.sleep(15); applied.push(theme); }, theme => events.push(theme));
  await Promise.all([appearance.set("dark"), appearance.set("light")]);
  expect(applied).toEqual(["dark", "light"]);
  expect(events).toEqual(["dark", "light"]);
  expect(appearance.get()).toEqual({ theme: "light" });
  const failing = new Appearance(store, async () => { throw new Error("Native unavailable"); }, () => { throw new Error("Must not emit"); });
  await expect(failing.set("dark")).rejects.toThrow("Native unavailable");
  expect(store.value.theme).toBe("light");
});
