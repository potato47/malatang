import { mkdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "@semicoder/fia/api";
import type { BackendPlugin, InstallJob, JSONValue, PluginContext, PluginInfo, PluginManifest } from "@semicoder/malatang-sdk/types";
import { Store } from "./store";
import { Models } from "./models";

export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), name: z.string().min(1).max(60),
  description: z.string().max(240), icon: z.string().min(1).max(4), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sdkVersion: z.literal("0.1"), frontend: z.string().min(1), backend: z.string().min(1).optional(), styles: z.string().min(1).optional(),
  keepAlive: z.boolean().default(false),
});
type Loaded = { info: PluginInfo; manifest: PluginManifest; root: string; backend?: BackendPlugin; calls: number; changing: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function containedFile(root: string, name: string) {
  if (isAbsolute(name) || name.includes("\\") || name.split("/").includes("..")) throw new Error("插件入口必须是包内相对路径");
  const base = await realpath(root);
  const target = await realpath(resolve(base, name));
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("插件资源越出包目录");
  if (!(await Bun.file(target).exists())) throw new Error("插件资源不存在：" + name);
  return target;
}

export class Plugins {
  private registry = new Map<string, Loaded>();
  private jobs: InstallJob[] = [];
  private installation?: { job: InstallJob; process?: Bun.Subprocess; done: Promise<void> };
  private stopping = false;
  constructor(private store: Store, private models: Models, private codeDirectory: string, private changed: () => void) {}
  async open() {
    await this.load(join(this.codeDirectory, "plugins/translate"), "builtin", true);
    for (const record of this.store.value.plugins) {
      try { await this.load(record.root, record.source, false); }
      catch (error) {
        this.registry.set(record.id, { root: record.root, manifest: { schemaVersion: 1, id: record.id, name: record.id, description: "安装文件缺失或清单无效，请卸载后重新安装。", icon: "!", color: "#bc6452", sdkVersion: "0.1", frontend: "dist/client.js" }, calls: 0, changing: false, info: { id: record.id, name: record.id, description: "安装文件无法加载", icon: "!", color: "#bc6452", version: "unknown", packageName: record.id, source: record.source, builtin: false, enabled: false, status: "error", error: message(error), clientURL: "", styleURL: null, keepAlive: false, methods: [] } });
      }
    }
  }
  list() { return [...this.registry.values()].map(item => structuredClone(item.info)); }
  get(id: string) { const plugin = this.registry.get(id); if (!plugin) throw new Error("插件不存在"); return plugin; }
  async use<T>(id: string, action: (plugin: Loaded) => T | Promise<T>): Promise<T> {
    const plugin = this.get(id);
    if (this.stopping || plugin.changing || plugin.info.status !== "active") throw new Error("插件未就绪或已停用");
    plugin.calls++;
    try { return await action(plugin); } finally { plugin.calls--; }
  }
  private context(id: string): PluginContext {
    return { pluginId: id, models: { list: () => this.models.list(), start: input => this.use(id, () => this.models.start(id, input)) }, kv: { get: key => this.store.get(id, key), set: (key, value) => this.store.set(id, key, value), delete: key => this.store.delete(id, key) } };
  }
  private async inspect(root: string, source: string, builtin: boolean): Promise<Loaded> {
    const pkg = await Bun.file(join(root, "package.json")).json();
    const manifest = manifestSchema.parse(pkg.malatang);
    if (["models", "plugins", "settings"].includes(manifest.id)) throw new Error("此插件 ID 为宿主保留名称");
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") throw new Error("插件缺少 package name/version");
    await containedFile(root, manifest.frontend);
    if (manifest.backend) await containedFile(root, manifest.backend);
    if (manifest.styles) await containedFile(root, manifest.styles);
    const enabled = !this.store.value.disabled.includes(manifest.id);
    const prefix = `/api/plugins/${manifest.id}/`;
    const revision = `?v=${Bun.hash(root + pkg.version).toString(36)}`;
    return { root, manifest, calls: 0, changing: false, info: { id: manifest.id, name: manifest.name, description: manifest.description, icon: manifest.icon, color: manifest.color, version: pkg.version, packageName: pkg.name, source, builtin, enabled, status: "disabled", error: null, clientURL: prefix + manifest.frontend + revision, styleURL: manifest.styles ? prefix + manifest.styles + revision : null, keepAlive: manifest.keepAlive, methods: [] } };
  }
  private async load(root: string, source: string, builtin: boolean) {
    const plugin = await this.inspect(root, source, builtin);
    if (this.registry.has(plugin.info.id)) throw new Error("插件 ID 已安装：" + plugin.info.id);
    this.registry.set(plugin.info.id, plugin);
    if (plugin.info.enabled) await this.activate(plugin);
    return plugin;
  }
  private async activate(plugin: Loaded) {
    try {
      if (plugin.manifest.backend) {
        const file = await containedFile(plugin.root, plugin.manifest.backend);
        const mod = await import(pathToFileURL(file).href);
        const backend = mod.default as BackendPlugin;
        if (!backend || typeof backend.methods !== "object") throw new Error("后端未导出 definePlugin 对象");
        plugin.info.methods = Object.entries(backend.methods).map(([name, method]) => {
          if (typeof method.execute !== "function" || typeof method.description !== "string") throw new Error("无效的插件方法：" + name);
          return { name, description: method.description, inputSchema: z.json().parse(method.inputSchema) };
        });
        plugin.backend = backend;
        await backend.activate?.(this.context(plugin.info.id));
      }
      plugin.info.status = "active"; plugin.info.error = null;
    } catch (error) { plugin.info.status = "error"; plugin.info.error = message(error); }
  }
  async invoke(id: string, method: string, input: JSONValue): Promise<JSONValue> {
    return this.use(id, async plugin => {
      if (!Object.hasOwn(plugin.backend?.methods ?? {}, method)) throw new Error("插件方法不存在");
      const result = await plugin.backend!.methods[method]!.execute(input, this.context(id));
      const json = z.json().parse(result);
      if (Buffer.byteLength(JSON.stringify(json)) > 256 * 1024) throw new Error("插件结果超过 256 KiB 上限");
      return json;
    });
  }
  async setEnabled(id: string, enabled: boolean) {
    const plugin = this.get(id);
    if (plugin.changing || plugin.calls || this.models.busy(id)) throw new Error("插件正在运行，请先停止任务");
    if (plugin.info.enabled === enabled && plugin.info.status !== "error") return structuredClone(plugin.info);
    plugin.changing = true;
    try {
      if (!enabled) await plugin.backend?.dispose?.();
      await this.store.update(state => { state.disabled = [...state.disabled.filter(item => item !== id), ...(enabled ? [] : [id])]; });
      plugin.info.enabled = enabled;
      if (enabled) await this.activate(plugin);
      else { plugin.info.status = "disabled"; plugin.backend = undefined; }
      this.changed(); return structuredClone(plugin.info);
    } finally { plugin.changing = false; }
  }
  async uninstall(id: string) {
    const plugin = this.get(id);
    if (plugin.info.builtin) throw new Error("内置插件可以停用，不能卸载");
    if (plugin.changing || plugin.calls || this.models.busy(id)) throw new Error("插件正在运行，请先停止任务");
    plugin.changing = true;
    try {
      await plugin.backend?.dispose?.();
      const record = this.store.value.plugins.find(item => item.id === id);
      await this.store.update(state => { state.plugins = state.plugins.filter(item => item.id !== id); state.disabled = state.disabled.filter(item => item !== id); });
      this.registry.delete(id); this.changed();
      if (record && relative(join(this.store.directory, "packages"), record.installation).match(/^[a-f0-9-]+$/)) await rm(record.installation, { recursive: true, force: true });
    } finally { plugin.changing = false; }
  }
  listJobs() { return structuredClone(this.jobs); }
  install(source: string): InstallJob {
    if (this.stopping || this.installation) throw new Error("已有安装任务正在运行");
    if (source.startsWith("-") || /[\x00-\x1f]/.test(source)) throw new Error("无效安装来源");
    if (!(isAbsolute(source) && source.endsWith(".tgz")) && !/^(?:@?[a-z0-9][a-z0-9._/-]*(?:@[^\s]+)?|git\+https:\/\/\S+|https:\/\/\S+\.git(?:#\S+)?|github:[^\s]+)$/.test(source)) throw new Error("请输入 npm 包名、Git HTTPS 地址或本地 .tgz 绝对路径");
    const job: InstallJob = { id: crypto.randomUUID(), source, status: "installing", message: "正在获取插件包…", pluginId: null, createdAt: Date.now() };
    this.jobs = [job, ...this.jobs].slice(0, 20);
    const slot = { job, done: Promise.resolve(), process: undefined as Bun.Subprocess | undefined };
    this.installation = slot;
    slot.done = this.performInstall(slot);
    this.changed(); return structuredClone(job);
  }
  installExample() { return this.install(join(this.codeDirectory, "resources/plugins/quick-notes.tgz")); }
  private async performInstall(slot: NonNullable<Plugins["installation"]>) {
    const installation = join(this.store.directory, "packages", slot.job.id);
    let installed = false;
    try {
      if (isAbsolute(slot.job.source) && !(await Bun.file(slot.job.source).exists())) throw new Error("本地归档不存在");
      await mkdir(installation, { recursive: true });
      await Bun.write(join(installation, "package.json"), JSON.stringify({ name: "malatang-plugin-installation", private: true }));
      slot.process = Bun.spawn([process.execPath, "add", "--ignore-scripts", slot.job.source], { cwd: installation, stdout: "ignore", stderr: "ignore" });
      const timeout = setTimeout(() => slot.process?.kill(), 120000);
      let exit: number; try { exit = await slot.process.exited; } finally { clearTimeout(timeout); }
      if (exit !== 0 || this.stopping) throw new Error(this.stopping ? "应用关闭，安装已取消" : "包获取失败或超时。请检查包地址、网络及预构建产物。");
      const receipt = await Bun.file(join(installation, "package.json")).json();
      const names = Object.keys(receipt.dependencies ?? {});
      if (names.length !== 1) throw new Error("安装包未声明唯一入口");
      const root = join(installation, "node_modules", names[0]!);
      const plugin = await this.inspect(root, slot.job.source, false);
      if (this.registry.has(plugin.info.id)) throw new Error("插件已安装，请先卸载再安装新版本");
      slot.job.message = "已校验插件，正在激活…"; this.changed();
      await this.store.update(state => { state.plugins.push({ id: plugin.info.id, root, installation, source: slot.job.source }); });
      installed = true;
      this.registry.set(plugin.info.id, plugin);
      await this.activate(plugin);
      slot.job.pluginId = plugin.info.id;
      if (plugin.info.status === "error") throw new Error("安装已保存，但后端激活失败：" + plugin.info.error);
      slot.job.status = "completed"; slot.job.message = "安装完成，可以从侧栏打开";
    } catch (error) {
      slot.job.status = "failed"; slot.job.message = message(error);
      if (!installed) await rm(installation, { recursive: true, force: true }).catch(() => {});
    } finally { this.installation = undefined; this.changed(); }
  }
  async asset(request: Request) {
    if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
    try {
      const match = new URL(request.url).pathname.match(/^\/plugins\/([^/]+)\/(.+)$/);
      if (!match) return new Response("Not found", { status: 404 });
      const plugin = this.get(decodeURIComponent(match[1]!));
      if (plugin.info.status !== "active") return new Response("Plugin is disabled", { status: 404 });
      const name = decodeURIComponent(match[2]!);
      // Frontend bundles and their assets live in dist; never serve backend source or package credentials.
      if (!name.startsWith("dist/") || name === plugin.manifest.backend || !/\.(js|css|svg|png|woff2?)$/.test(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(await containedFile(plugin.root, name));
      return new Response(request.method === "HEAD" ? null : file, { headers: { "Content-Type": file.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch { return new Response("Not found", { status: 404 }); }
  }
  busy() { return Boolean(this.installation) || [...this.registry.values()].some(item => item.calls || item.changing); }
  async stop() {
    this.stopping = true;
    this.installation?.process?.kill();
    await this.installation?.done;
    await Promise.allSettled([...this.registry.values()].map(plugin => plugin.backend?.dispose?.()));
  }
}
