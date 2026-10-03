import { z } from "@semicoder/fia/api";
import type { ModelInfo, ModelRequest, ModelRun } from "@malatang/sdk/types";
import { modelInput } from "../shared/api";
import { Store, type ModelConfig } from "./store";

export const DEMO_MODEL: ModelInfo = { id: "demo", name: "演示模型", provider: "本地预览", model: "demo", baseURL: "", kind: "demo", configured: true };
export const DEMO_TEXT = "Good tools disappear into the work. They give ideas room to grow, and make the complicated feel simple.";
const demoTranslations: Record<string, string> = {
  "简体中文": "好的工具会融入工作本身。它们为想法留出成长的空间，让复杂的事情变得简单。",
  "English": DEMO_TEXT,
  "日本語": "優れた道具は、仕事の中に自然に溶け込む。アイデアが育つ余地を生み、複雑なことをシンプルにしてくれる。",
  "한국어": "좋은 도구는 작업 속에 자연스럽게 녹아듭니다. 아이디어가 자랄 공간을 만들고, 복잡한 일을 단순하게 해줍니다.",
  "Français": "Les bons outils se fondent dans le travail. Ils laissent aux idées l’espace de grandir et rendent simple ce qui semblait compliqué.",
};

/** SSE parser preserves UTF-8 and frame boundaries across arbitrary network chunks. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 2 * 1024 * 1024) throw new Error("模型返回的单个流片段过大");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line === "") { if (data.length) { yield data.join("\n"); data = []; } }
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (chunk.done) { if (pending.startsWith("data:")) data.push(pending.slice(5).trim()); if (data.length) yield data.join("\n"); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class Models {
  private terminal = new Map<string, ModelRun>();
  private starting = 0;
  private active = new Map<string, { controller: AbortController; run: ModelRun; done: Promise<void> }>();
  constructor(private store: Store, private changed: (run: ModelRun) => void, private modelsChanged: () => void, private fetcher: typeof fetch = fetch) {}
  list(): ModelInfo[] { return [DEMO_MODEL, ...this.store.value.models.map(config => this.info(config))]; }
  private info(config: ModelConfig): ModelInfo {
    const { apiKey, ...info } = config;
    return { ...info, kind: "openai-compatible", configured: Boolean(apiKey) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.baseURL) };
  }
  async save(input: z.infer<typeof modelInput>): Promise<ModelInfo> {
    const url = new URL(input.baseURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请输入不包含认证信息或查询参数的 HTTP(S) API 地址");
    if (input.id === "demo") throw new Error("演示模型不可修改");
    const config = await this.store.update(state => {
      const existing = state.models.find(model => model.id === input.id);
      if (input.id && !existing) throw new Error("模型不存在");
      const config: ModelConfig = { id: existing?.id ?? crypto.randomUUID(), name: input.name, provider: input.provider, model: input.model, baseURL: input.baseURL.replace(/\/+$/, ""), apiKey: input.clearApiKey ? "" : input.apiKey?.trim() || existing?.apiKey || "" };
      state.models = [...state.models.filter(model => model.id !== config.id), config];
      return config;
    });
    this.modelsChanged();
    return this.info(config);
  }
  async remove(id: string) {
    if (id === "demo") throw new Error("演示模型不可删除");
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
    if (request.modelId !== "demo" && !config) throw new Error("请先在模型设置中添加模型");
    if (!request.prompt.trim() || request.prompt.length > 16000 || (request.system?.length ?? 0) > 16000) throw new Error("输入为空或超过 16000 字符");
    const now = Date.now();
    const run: ModelRun = { id: crypto.randomUUID(), pluginId, modelId: request.modelId, title: (request.title ?? request.prompt.slice(0, 40)).slice(0, 100), input: request.prompt, output: "", status: "running", error: null, createdAt: now, updatedAt: now, revision: 0, demo: !config };
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
  private async perform(slot: { controller: AbortController; run: ModelRun }, request: ModelRequest, config?: ModelConfig) {
    const { run, controller } = slot;
    const timeout = setTimeout(() => controller.abort(new Error("模型响应超时，请重试")), 180000);
    let lastNotification = 0;
    const append = (text: string) => {
      if (Buffer.byteLength(run.output + text) > 64 * 1024) throw new Error("输出已达到 MVP 的 64 KiB 上限");
      run.output += text; run.updatedAt = Date.now(); run.revision++;
      if (Date.now() - lastNotification > 60) { this.changed(run); lastNotification = Date.now(); }
    };
    try {
      if (config) await this.stream(config, request, controller.signal, append);
      else {
        const language = Object.keys(demoTranslations).find(language => request.system?.includes(`target: ${language}`)) ?? "简体中文";
        const output = request.prompt.trim() === DEMO_TEXT
          ? demoTranslations[language]!
          : "这是演示模型的流式输出，用于体验插件页面与宿主 SDK。它不会翻译任意文本。请载入示例体验预置译文，或在模型设置中添加真实模型。";
        for (const piece of output.match(/.{1,3}/gu) ?? []) {
          controller.signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
            const timer = setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, 35);
            controller.signal.addEventListener("abort", abort, { once: true });
          });
          append(piece);
        }
      }
      controller.signal.throwIfAborted();
      run.status = "completed";
    } catch (error) {
      run.status = controller.signal.aborted && controller.signal.reason?.name === "AbortError" ? "cancelled" : "failed";
      run.error = run.status === "cancelled" ? null : error instanceof Error ? error.message : String(error);
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
