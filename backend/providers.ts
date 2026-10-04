import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ProviderPreset, PresetModel, ModelRequest } from "@malatang/sdk/types";
import type { ModelConfig } from "./store";

const providers = new Map(builtinProviders().map(provider => [provider.id, provider]));
const fields: Record<string, ProviderPreset["fields"]> = {
  "cloudflare-workers-ai": [{ key: "accountId", label: "Account ID", placeholder: "Cloudflare 账户 ID", required: true }],
  "cloudflare-ai-gateway": [
    { key: "accountId", label: "Account ID", placeholder: "Cloudflare 账户 ID", required: true },
    { key: "gatewayId", label: "Gateway ID", placeholder: "AI Gateway 名称", required: true },
  ],
  "azure-openai-responses": [
    { key: "deployment", label: "部署名称", placeholder: "留空使用所选模型 ID", required: false },
    { key: "apiVersion", label: "API 版本", placeholder: "v1", required: false },
  ],
  "amazon-bedrock": [{ key: "region", label: "AWS 区域", placeholder: "us-east-1", required: true }],
};

function getProvider(id: string) {
  const provider = providers.get(id);
  if (!provider) throw new Error("未知的 Pi 服务商，请从预设列表中选择");
  return provider;
}

export function listProviders(): ProviderPreset[] {
  return [...providers.values()].map(provider => ({
    id: provider.id, name: provider.name, modelCount: provider.getModels().length,
    apiKeySupported: Boolean(provider.auth.apiKey), keyLabel: provider.auth.apiKey?.name ?? "需要订阅登录",
    notice: !provider.getModels().length ? "此预设仅提供非聊天模型，当前文本生成接口暂不可用。"
      : !provider.auth.apiKey ? "此预设需要订阅登录，当前版本尚未接入登录流程。"
      : provider.id === "amazon-bedrock" ? "使用 Bedrock Bearer Token；AWS Profile / IAM 登录后续接入。"
      : provider.id === "google-vertex" ? "使用 Google Cloud API Key；ADC / 服务账号认证后续接入。"
      : provider.id === "github-copilot" ? "使用 Pi 支持的 Copilot token；GitHub 订阅登录后续接入。"
      : provider.id === "openai" ? "此表单使用 API Key；ChatGPT 订阅请在模型列表上方连接。"
      : provider.auth.oauth ? "当前通过 API Key 配置，订阅登录后续接入。" : "",
    fields: fields[provider.id] ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listPresetModels(id: string): PresetModel[] {
  return getProvider(id).getModels().map(model => ({ id: model.id, name: model.name, api: model.api, baseURL: model.baseUrl, contextWindow: model.contextWindow, reasoning: model.reasoning }));
}

export function isPresetModelAvailable(id: string, modelId: string): boolean {
  const provider = providers.get(id);
  return Boolean(provider?.auth.apiKey && provider.getModels().some(model => model.id === modelId));
}

export function validatePreset(id: string, modelId: string, baseURL: string, options: Record<string, string>) {
  const provider = getProvider(id);
  if (!provider.auth.apiKey) throw new Error("此服务商需要订阅登录，当前版本尚未支持");
  if (!provider.getModels().some(model => model.id === modelId)) throw new Error("请从该服务商的 Pi 预设模型中选择");
  const allowed = fields[id] ?? [];
  if (Object.keys(options).some(key => !allowed.some(field => field.key === key))) throw new Error("配置包含不属于该服务商的选项");
  for (const field of allowed) if (field.required && !options[field.key]?.trim()) throw new Error(`请填写 ${field.label}`);
  for (const key of ["accountId", "gatewayId", "region"]) if (options[key] && !/^[a-zA-Z0-9_-]+$/.test(options[key])) throw new Error(`${key} 包含无效字符`);
  if (id === "azure-openai-responses" && !baseURL) throw new Error("请填写 Azure OpenAI 资源的 API 地址");
  return provider.name;
}

/** Pi owns protocol/auth differences; credentials and lifecycle stay with the host. */
export async function streamPreset(config: ModelConfig, request: ModelRequest, signal: AbortSignal, append: (text: string) => void, fetcher: typeof fetch) {
  const provider = getProvider(config.preset!);
  const original = provider.getModels().find(model => model.id === config.model);
  if (!original) throw new Error("预设模型已不存在，请重新选择模型");
  if (!config.apiKey) throw new Error("请在设置中为此模型配置 API Key 或 Token");
  const env: Record<string, string> = {};
  const { accountId, gatewayId, region, apiVersion, deployment } = config.options;
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  if (gatewayId) env.CLOUDFLARE_GATEWAY_ID = gatewayId;
  if (region) env.AWS_REGION = region;
  if (apiVersion) env.AZURE_OPENAI_API_VERSION = apiVersion;
  if (deployment) env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP = `${config.model}=${deployment}`;
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(provider.id, async () => ({ type: "api_key", key: config.apiKey, env }));
  // No implicit import of credentials from another application's environment/files.
  const runtime = createModels({ credentials, authContext: { env: async () => undefined, fileExists: async () => false } });
  runtime.setProvider(provider);
  const model = { ...original, ...(config.baseURL ? { baseUrl: config.baseURL } : {}) };
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let completed = false;
  let length = 0;
  try {
    const stream = runtime.streamSimple(model, { systemPrompt: request.system, messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }] }, {
      signal: controller.signal, env, maxTokens: Math.min(model.maxTokens, 8192),
      ...(fetcher !== fetch ? { fetch: fetcher } : {}),
    });
    for await (const event of stream) {
      signal.throwIfAborted();
      if (event.type === "text_delta") { append(event.delta); length += event.delta.length; }
      if (event.type === "error") {
        const message = event.error.errorMessage || "模型服务返回错误，请检查配置";
        throw new Error(message.replaceAll(config.apiKey, "[已隐藏]").slice(0, 600));
      }
      if (event.type === "done") {
        if (event.reason !== "stop") throw new Error(event.reason === "length" ? "模型达到输出限制，结果可能不完整" : "此模型返回了当前文本接口不支持的任务类型");
        completed = true;
      }
    }
    if (!completed) throw new Error("连接在模型完成前中断");
    if (!length) throw new Error("模型未返回文本内容");
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
    await credentials.delete(provider.id);
  }
}
