import { z } from "@semicoder/fia/api";
import type { ModelInfo, ModelRequest, ModelRun } from "@semicoder/malatang-sdk/types";
import { modelInput } from "../shared/api";
import { Store, type ModelConfig } from "./store";
import type { ChatGPT } from "./chatgpt";
import { isPresetModelAvailable, streamPreset, validatePreset } from "./providers";

export { readSSE } from "./sse";
import { readSSE } from "./sse";

export class Models {
  private terminal = new Map<string, ModelRun>();
  private starting = 0;
  private active = new Map<string, { controller: AbortController; run: ModelRun; done: Promise<void> }>();
  constructor(private store: Store, private changed: (run: ModelRun) => void, private modelsChanged: () => void, private fetcher: typeof fetch = fetch, private chatgpt?: ChatGPT) {}
  list(): ModelInfo[] { return this.store.value.models.map(config => this.info(config)); }
  private info(config: ModelConfig): ModelInfo {
    const { apiKey, ...info } = config;
    if (config.chatgptProfileId) return { ...info, provider: this.chatgpt?.status().profiles.find(p => p.id === config.chatgptProfileId)?.label ?? info.provider, kind: "chatgpt", hasApiKey: false, configured: this.chatgpt?.connected(config.chatgptProfileId) ?? false };
    return { ...info, kind: config.preset ? "pi" : "openai-compatible", hasApiKey: Boolean(apiKey), configured: config.preset ? Boolean(apiKey) && isPresetModelAvailable(config.preset, config.model) : Boolean(apiKey) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.baseURL) };
  }
  async save(input: z.infer<typeof modelInput>): Promise<ModelInfo> {
    input = modelInput.parse(input);
    const preset = input.preset ?? null;
    const baseURL = input.baseURL.replace(/\/+$/, "");
    if (baseURL || !preset) {
      let url: URL;
      try { url = new URL(baseURL); } catch { throw new Error("请输入有效的 HTTP(S) API 地址"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请输入不包含认证信息或查询参数的 HTTP(S) API 地址");
    }
    const options = Object.fromEntries(Object.entries(input.options ?? {}).filter(([, value]) => value));
    const provider = preset ? validatePreset(preset, input.model, baseURL, options) : input.provider;
    if (!preset && Object.keys(options).length) throw new Error("自定义兼容服务不支持预设服务商选项");
    const config = await this.store.update(state => {
      const existing = state.models.find(model => model.id === input.id);
      if (existing?.chatgptProfileId) throw new Error("订阅模型与账号绑定，请删除后从 ChatGPT 连接中重新添加");
      if (input.id && !existing) throw new Error("模型不存在");
      const sameConnection = existing && existing.preset === preset && existing.provider === provider && existing.baseURL === baseURL;
      const config: ModelConfig = { id: existing?.id ?? crypto.randomUUID(), name: input.name, provider, model: input.model, baseURL, preset, options, apiKey: input.clearApiKey ? "" : input.apiKey?.trim() || (sameConnection ? existing.apiKey : "") };
      state.models = [...state.models.filter(model => model.id !== config.id), config];
      return config;
    });
    this.modelsChanged();
    return this.info(config);
  }
  async addChatGPTModel(profileId: string, modelId: string): Promise<ModelInfo> {
    if (!this.chatgpt?.connected(profileId)) throw new Error("请先连接 ChatGPT 并允许使用订阅");
    const model = await this.chatgpt.model(profileId, modelId);
    const label = this.chatgpt.status().profiles.find(p => p.id === profileId)!.label;
    const config = await this.store.update(state => {
      if (!this.chatgpt?.connected(profileId)) throw new Error("ChatGPT 连接已断开，请重新登录后添加模型");
      const existing = state.models.find(m => m.chatgptProfileId === profileId && m.model === modelId);
      if (existing) return existing;
      const item: ModelConfig = { id: crypto.randomUUID(), name: model.name.slice(0, 100), provider: label, model: modelId, baseURL: "https://api.openai.com/v1", apiKey: "", preset: null, options: {}, chatgptProfileId: profileId };
      state.models.push(item); return item;
    });
    this.modelsChanged(); return this.info(config);
  }
  async remove(id: string) {
    if ([...this.active.values()].some(item => item.run.modelId === id)) throw new Error("此模型正在运行，请先停止任务");
    await this.store.update(state => { state.models = state.models.filter(model => model.id !== id); });
    this.modelsChanged();
  }
  get(pluginId: string, runId: string): ModelRun {
    const run = this.active.get(runId)?.run ?? this.terminal.get(runId) ?? this.store.value.runs.find(item => item.id === runId);
    if (!run || run.pluginId !== pluginId) throw new Error("运行记录不存在");
    return structuredClone(run);
  }
  listRuns(pluginId: string): ModelRun[] {
    return this.store.value.runs.filter(run => run.pluginId === pluginId).slice(-30).reverse().map(run => { const full = this.get(pluginId, run.id); return { ...full, input: full.input.slice(0, 300), output: full.output.slice(0, 300) }; });
  }
  busy(pluginId?: string): boolean { return this.starting > 0 || [...this.active.values()].some(item => !pluginId || item.run.pluginId === pluginId); }
  async start(pluginId: string, request: ModelRequest): Promise<ModelRun> {
    if (this.active.size + this.starting >= 8) throw new Error("最多同时运行 8 个任务");
    const config = this.store.value.models.find(model => model.id === request.modelId);
    if (!config) throw new Error("模型不存在，请先在设置 → 模型服务中添加模型");
    if (config.preset && !config.chatgptProfileId && !isPresetModelAvailable(config.preset, config.model)) throw new Error("预设模型已不在当前目录中，请在设置 → 模型服务中重新选择模型");
    if (!request.prompt.trim() || request.prompt.length > 16000 || (request.system?.length ?? 0) > 16000) throw new Error("输入为空或超过 16000 字符");
    const now = Date.now();
    const run: ModelRun = { id: crypto.randomUUID(), pluginId, modelId: request.modelId, title: (request.title ?? request.prompt.slice(0, 40)).slice(0, 100), input: request.prompt, output: "", status: "running", error: null, createdAt: now, updatedAt: now, revision: 0, demo: false };
    this.starting++;
    try {
      await this.store.update(state => {
        const keep = new Set(state.runs.filter(item => item.pluginId === pluginId).slice(-29).map(item => item.id));
        state.runs = [...state.runs.filter(item => item.pluginId !== pluginId || item.status === "running" || keep.has(item.id)), run];
      });
    } finally { this.starting--; }
    const controller = new AbortController();
    const slot = { controller, run, done: Promise.resolve() };
    this.active.set(run.id, slot);
    slot.done = this.perform(slot, request, config);
    this.changed(run);
    return structuredClone(run);
  }
  private async perform(slot: { controller: AbortController; run: ModelRun }, request: ModelRequest, config: ModelConfig) {
    const { run, controller } = slot;
    const timeout = setTimeout(() => controller.abort(new Error("模型响应超时，请重试")), 180000);
    let lastNotification = 0;
    const append = (text: string) => {
      if (Buffer.byteLength(run.output + text) > 64 * 1024) throw new Error("输出已达到 MVP 的 64 KiB 上限");
      run.output += text; run.updatedAt = Date.now(); run.revision++;
      if (Date.now() - lastNotification > 60) { this.changed(run); lastNotification = Date.now(); }
    };
    try {
      await this.stream(config, request, controller.signal, append);
      controller.signal.throwIfAborted();
      run.status = "completed";
    } catch (error) {
      run.status = controller.signal.aborted && controller.signal.reason?.name === "AbortError" ? "cancelled" : "failed";
      run.error = run.status === "cancelled" ? null : error instanceof Error ? error.message : String(error);
      if (run.error && config.apiKey) run.error = run.error.replaceAll(config.apiKey, "[已隐藏]");
    } finally {
      clearTimeout(timeout);
      run.updatedAt = Date.now(); run.revision++;
      try {
        await this.store.update(state => { const index = state.runs.findIndex(item => item.id === run.id); if (index >= 0) state.runs[index] = structuredClone(run); });
      } catch {
        run.status = "failed"; run.error = "结果持久化失败，请检查磁盘空间。当前结果仅保留在本次进程中。";
        this.terminal.set(run.id, structuredClone(run));
      } finally { this.active.delete(run.id); this.changed(run); }
    }
  }
  private async stream(config: ModelConfig, request: ModelRequest, signal: AbortSignal, append: (text: string) => void) {
    if (config.chatgptProfileId) { if (!this.chatgpt) throw new Error("ChatGPT 登录不可用"); return this.chatgpt.stream(config.chatgptProfileId, config.model, request, signal, append); }
    if (config.preset) return streamPreset(config, request, signal, append, this.fetcher);
    const response = await this.fetcher(config.baseURL + "/chat/completions", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: "Bearer " + config.apiKey } : {}) },
      body: JSON.stringify({ model: config.model, stream: true, messages: [...(request.system ? [{ role: "system", content: request.system }] : []), { role: "user", content: request.prompt }] }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`模型请求失败（HTTP ${response.status}）。请检查 API 地址、模型名称和密钥。`); }
    if (!response.body) throw new Error("模型返回了空响应");
    let finished = false;
    let contentLength = 0;
    for await (const data of readSSE(response.body)) {
      signal.throwIfAborted();
      if (data.trim() === "[DONE]") { finished = true; break; }
      const event = JSON.parse(data) as { error?: unknown; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
      if (event.error) throw new Error("模型服务返回错误，请检查配置或稍后重试");
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === "string") { append(choice.delta.content); contentLength += choice.delta.content.length; }
      if (choice?.finish_reason) {
        if (!["stop", "length"].includes(choice.finish_reason)) throw new Error("模型未正常完成：" + choice.finish_reason);
        if (choice.finish_reason === "length") throw new Error("模型达到输出限制，以下内容可能不完整");
        finished = true;
      }
    }
    if (!finished) throw new Error("连接在模型完成前中断，可以重新发起");
    if (!contentLength) throw new Error("模型未返回文本内容，请检查模型兼容性");

  }
  async cancel(pluginId: string, runId: string) {
    this.get(pluginId, runId);
    const slot = this.active.get(runId);
    if (slot) { slot.controller.abort(new DOMException("Cancelled", "AbortError")); await slot.done; }
    return this.get(pluginId, runId);
  }
  async stop() {
    const active = [...this.active.values()];
    for (const slot of active) slot.controller.abort(new DOMException("Application stopped", "AbortError"));
    await Promise.allSettled(active.map(slot => slot.done));
  }
}
