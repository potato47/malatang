import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "@semicoder/fia/api";
import type { ChatGPTModel, ChatGPTStatus } from "../shared/chatgpt";
import { chatGPTLabel } from "../shared/chatgpt";
import type { ModelRequest } from "@malatang/sdk/types";
import { readSSE } from "./sse";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE = ISSUER + "/api/accounts/authorize";
const TOKEN = ISSUER + "/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const DIRECT = "chatgpt.tokens.use.direct";
const SCOPE = "openid profile email offline_access resource.invoke " + DIRECT;
const secret = z.string().min(1).max(32000);
const tokens = z.object({ access: secret, refresh: secret.nullable(), id: secret, expiresAt: z.number(), scopes: z.array(z.string()) });
const profile = z.object({ id: z.string(), clientId: z.string(), subject: z.string().nullable(), email: z.string().nullable(), label: z.string(), welcomeSeen: z.boolean(), tokens: tokens.nullable() });
const vaultSchema = z.object({ version: z.literal(1), hostId: z.string(), activeProfileId: z.string().nullable(), profiles: z.array(profile).max(10) });
type Vault = z.infer<typeof vaultSchema>;
type Profile = z.infer<typeof profile>;
type Tokens = z.infer<typeof tokens>;
type Attempt = { id: string; state: string; nonce: string; verifier: string; redirectURI: string; profileId?: string; controller: AbortController; expires: number; timer: ReturnType<typeof setTimeout>; consumed: boolean; committing?: boolean };
interface Services {
  readSecret(): Promise<string | null>;
  writeSecret(value: string): Promise<unknown>;
  openURL(url: string): Promise<unknown>;
  redirectURI: string;
  changed(): void;
  modelCount?(profileId: string): number;
  fetcher?: typeof fetch;
}
const random = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const terminalRefresh = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const messages: Record<string, string> = {
  unsupported_country_region_territory: "OpenAI 不支持当前请求所来自的国家或地区。请检查本机系统代理与网络出口；修改代理设置后重启麻辣烫再试。ChatGPT 订阅不会解除地区限制。",
  subscription_sharing_user_not_eligible: "当前 ChatGPT 账号或工作区暂不支持订阅调用，请检查订阅和工作区策略。",
  subscription_sharing_usage_limit_exceeded: "ChatGPT 用量已达到限制。请前往 ChatGPT 的用量设置检查额度或应用限额后再试。",
  subscription_sharing_usage_unavailable: "ChatGPT 暂时无法核对用量，请稍后重试。",
  subscription_sharing_user_unavailable: "ChatGPT 账号服务暂不可用，请稍后重试。",
  subscription_sharing_unsupported_capability: "当前订阅不支持所选模型或请求能力，请更换可用模型。",
  subscription_sharing_route_not_supported: "ChatGPT 不支持此次接口请求。",
  subscription_sharing_invalid_user: "ChatGPT 未能验证账号，请检查连接状态。",
  chatpass_v2_scope_not_authorized: "尚未获得 ChatGPT 订阅使用权限，请在设置中重新授权。",
  chatpass_v2_invalid_authorization_context: "ChatGPT 授权上下文无效，请检查所选账号。",
  invalid_client: "OpenAI 客户端注册无效，请检查登录配置。",
};
class OpenAIError extends Error {
  constructor(readonly code: string, status?: number, param?: string, requestId?: string) {
    // Never echo arbitrary server messages, callback query strings or token responses.
    const safe = (s?: string) => s && /^[\w.-]{1,120}$/.test(s) ? s : "";
    super((messages[code] ?? (terminalRefresh.has(code) ? "登录已失效，请重新登录 ChatGPT。" : "OpenAI 请求失败，请检查网络、账号权限或稍后重试。")) + [status && `HTTP ${status}`, safe(code), safe(param) && `参数 ${param}`, safe(requestId) && `请求 ${requestId}`].filter(Boolean).map(item => `（${item}）`).join(""));
  }
}
function failure(data: unknown, status?: number, requestId?: string) {
  const value = data as { error?: { code?: unknown; param?: unknown } | string; code?: unknown; param?: unknown } | null;
  const error = value?.error ?? value;
  return new OpenAIError(typeof error === "string" ? error : typeof error?.code === "string" ? error.code : "", status, typeof error === "object" && typeof error?.param === "string" ? error.param : undefined, requestId);
}
const page = (ok: boolean) => new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>麻辣烫 · ChatGPT 登录</title><body><h1>${ok ? "登录完成" : "登录未完成"}</h1><p>请返回麻辣烫查看连接状态。现在可以关闭此页面。</p></body></html>`, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });

/** Tokens never cross the host API. One serialized vault owns registration and rotating tokens. */
export class ChatGPT {
  private vault: Vault = { version: 1, hostId: "", activeProfileId: null, profiles: [] };
  private available = false;
  private message = "";
  private attempt: ChatGPTStatus["attempt"] = null;
  private pending?: Attempt;
  private queue: Promise<unknown> = Promise.resolve();
  private fetcher: typeof fetch;
  private discovery?: Promise<{ jwks_uri: string; revocation_endpoint: string }>;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private catalogs = new Map<string, ChatGPTModel[]>();
  private requests = new Map<AbortController, string>();
  private signingOut = new Set<string>();
  private blocked = new Set<string>();
  private stopped = false;
  constructor(private services: Services) {
    this.fetcher = services.fetcher ?? fetch;
    const redirect = new URL(services.redirectURI);
    if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.pathname !== "/api/oauth/openai/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error("无效的 OpenAI loopback 回调地址");
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result;
  }
  private async persist(candidate: Vault) {
    try { await this.services.writeSecret(JSON.stringify(candidate)); }
    catch { throw new Error("无法保存 ChatGPT 账号信息，请检查系统钥匙串后重试。"); }
    this.vault = candidate; this.services.changed();
  }
  async open() {
    try {
      const saved = await this.services.readSecret();
      if (saved) this.vault = vaultSchema.parse(JSON.parse(saved));
      else await this.persist({ ...this.vault, hostId: "urn:uuid:" + crypto.randomUUID() });
      this.available = true;
    } catch { this.message = "无法读取或初始化 ChatGPT 凭证，请检查系统钥匙串并重启应用。"; }
  }
  status(): ChatGPTStatus {
    return { available: this.available, activeProfileId: this.vault.activeProfileId,
      profiles: this.vault.profiles.map(p => ({ id: p.id, label: p.label, email: p.email, connected: Boolean(p.tokens), sharing: Boolean(p.tokens?.scopes.includes(DIRECT)), welcomeSeen: p.welcomeSeen, incomplete: !p.subject && !p.tokens, removalBlockedReason: this.removalBlockedReason(p) })),
      attempt: this.attempt ? { ...this.attempt } : null, message: this.message };
  }
  connected(id: string): boolean { return Boolean(this.vault.profiles.find(p => p.id === id)?.tokens?.scopes.includes(DIRECT)) && !this.signingOut.has(id); }
  busy() { return Boolean(this.pending) || this.signingOut.size > 0 || this.requests.size > 0; }
  private get(id: string) { const p = this.vault.profiles.find(p => p.id === id); if (!p) throw new Error("ChatGPT 账号不存在"); return p; }
  private removalBlockedReason(p: Profile): string | null {
    if (this.pending) return "请先完成或取消正在进行的登录。";
    if (this.signingOut.has(p.id) || [...this.requests.values()].includes(p.id)) return "此账号仍有任务正在处理，请稍后重试。";
    if (p.tokens) return "请先退出此账号，再移除本地记录。";
    const count = this.services.modelCount?.(p.id) ?? 0;
    return count ? `此账号仍绑定 ${count} 个模型，请先从模型列表移除。` : null;
  }
  private nextLabel() {
    const labels = new Set(this.vault.profiles.map(p => p.label));
    let number = 1;
    while (labels.has(`ChatGPT 账号 ${number}`)) number++;
    return `ChatGPT 账号 ${number}`;
  }
  private assertEditable() {
    if (!this.available || this.stopped) throw new Error("ChatGPT 账号暂不可编辑，请检查钥匙串或重启应用");
    if (this.pending) throw new Error("请先完成或取消正在进行的登录。");
  }
  async rename(id: string, label: string) {
    label = chatGPTLabel.parse(label);
    this.assertEditable();
    return this.serial(async () => {
      this.assertEditable(); this.get(id);
      await this.persist({ ...this.vault, profiles: this.vault.profiles.map(p => p.id === id ? { ...p, label } : p) });
      return this.status();
    });
  }
  async remove(profileIds: string[]) {
    const ids = new Set(z.array(z.string()).min(1).max(10).parse(profileIds));
    this.assertEditable();
    return this.serial(async () => {
      this.assertEditable();
      for (const id of ids) { const reason = this.removalBlockedReason(this.get(id)); if (reason) throw new Error(reason); }
      const profiles = this.vault.profiles.filter(p => !ids.has(p.id));
      const activeProfileId = this.vault.activeProfileId && ids.has(this.vault.activeProfileId)
        ? profiles.findLast(p => p.tokens)?.id ?? null : this.vault.activeProfileId;
      await this.persist({ ...this.vault, profiles, activeProfileId });
      for (const id of ids) { this.catalogs.delete(id); this.blocked.delete(id); }
      if (this.attempt?.profileId && ids.has(this.attempt.profileId)) this.attempt = null;
      this.message = `已移除 ${ids.size} 个本地账号记录。`;
      this.services.changed(); return this.status();
    });
  }
  private changed(stage: NonNullable<ChatGPTStatus["attempt"]>["stage"], message: string, attempt: Attempt) {
    this.attempt = { id: attempt.id, profileId: attempt.profileId ?? null, stage, message }; this.services.changed();
  }
  async signIn(profileId?: string, consent = false) {
    return this.serial(async () => {
      if (!this.available || this.stopped) throw new Error("ChatGPT 登录暂不可用，请检查钥匙串或重启应用");
      if (this.pending) throw new Error("已有登录正在进行，请先完成或取消");
      const existing = profileId ? this.get(profileId) : undefined;
      if (!existing && this.vault.profiles.length >= 10) throw new Error("已达到 10 个账号注册上限");
      const attempt: Attempt = { id: crypto.randomUUID(), state: random(), nonce: random(), verifier: random(), redirectURI: this.services.redirectURI, profileId, controller: new AbortController(), expires: Date.now() + 600000, timer: undefined as never, consumed: false };
      attempt.timer = setTimeout(() => { void this.cancel(attempt.id, "登录已超时，请重新开始。"); }, 600000);
      this.pending = attempt;
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({ client_id: existing?.clientId ?? "dynamic_agent_client", ext_agent_host_id: this.vault.hostId, response_type: "code", redirect_uri: attempt.redirectURI, scope: SCOPE, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url") }).toString();
      if (!existing) url.searchParams.set("agent_name_hint", "Malatang");
      if (existing?.tokens?.id) url.searchParams.set("id_token_hint", existing.tokens.id);
      if (existing?.email) url.searchParams.set("login_hint", existing.email);
      if (consent) url.searchParams.set("prompt", "consent");
      this.message = ""; this.changed("waiting", "请在系统浏览器完成 ChatGPT 登录与授权。", attempt);
      try { await this.services.openURL(url.href); }
      catch { clearTimeout(attempt.timer); this.pending = undefined; this.changed("failed", "无法打开系统浏览器，请重试。", attempt); }
      return this.status();
    });
  }
  async cancel(id: string, message = "已取消登录。") {
    const attempt = this.pending;
    if (!attempt || attempt.id !== id || attempt.committing) return this.status();
    attempt.controller.abort(); clearTimeout(attempt.timer);
    return this.serial(async () => { if (this.pending === attempt) { this.pending = undefined; this.changed("cancelled", message, attempt); } return this.status(); });
  }
  async callback(request: Request): Promise<Response> {
    const attempt = this.pending; const url = new URL(request.url); const query = url.searchParams;
    const expected = new URL(this.services.redirectURI);
    if (request.method !== "GET" || url.origin !== expected.origin || ![expected.pathname, expected.pathname.slice(4)].includes(url.pathname)) return page(false);
    if (!attempt || attempt.consumed || attempt.expires <= Date.now() || query.getAll("state").length !== 1 || !equal(query.get("state") ?? "", attempt.state)) return page(false);
    for (const key of ["code", "client_id", "error"]) if (query.getAll(key).length > 1) return page(false);
    attempt.consumed = true;
    this.changed("exchanging", "正在验证账号并保存授权…", attempt);
    return this.serial(async () => {
      let ok = false;
      let step = "处理登录回调";
      try {
        attempt.controller.signal.throwIfAborted();
        if (query.has("error")) throw new Error(query.get("error") === "access_denied" ? "你已取消授权，可随时重新登录。" : "OpenAI 未完成授权，请重试。");
        const existing = attempt.profileId ? this.get(attempt.profileId) : undefined;
        const clientId = query.get("client_id") ?? existing?.clientId;
        if (!clientId || clientId === "dynamic_agent_client" || !/^[\w.-]{1,256}$/.test(clientId) || (existing && clientId !== existing.clientId)) throw new Error("登录回调的客户端注册不匹配，请重新登录。");
        const code = query.get("code");
        if (!code || code.length > 8192) throw new Error("登录回调缺少有效授权码。");
        const saved = existing ?? this.vault.profiles.find(p => p.clientId === clientId);
        const current: Profile = saved ?? { id: crypto.randomUUID(), clientId, subject: null, email: null, label: this.nextLabel(), welcomeSeen: false, tokens: null };
        // Retain the issued registration even if code exchange fails or the app restarts.
        if (!saved) await this.persist({ ...this.vault, profiles: [...this.vault.profiles, current] });
        attempt.profileId = current.id;
        step = "授权码交换";
        const data = await this.tokenRequest(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectURI, resource: RESOURCE }), attempt.controller.signal);
        const next = this.parseTokens(data);
        step = "验证账号";
        const identity = await this.verify(next.id, clientId, attempt.nonce);
        if (current.subject && identity.sub !== current.subject) throw new Error("返回的账号与已保存的注册不一致，原连接未被替换。");
        attempt.controller.signal.throwIfAborted();
        const updated: Profile = { ...current, subject: identity.sub!, email: typeof identity.email === "string" ? identity.email.slice(0, 320) : null, tokens: next };
        attempt.committing = true;
        step = "保存登录凭证";
        await this.persist({ ...this.vault, activeProfileId: current.id, profiles: this.vault.profiles.map(p => p.id === current.id ? updated : p) });
        this.catalogs.delete(current.id); this.blocked.delete(current.id);
        this.changed("completed", next.scopes.includes(DIRECT) ? "已连接 ChatGPT，可以获取模型。" : "已登录，但尚未允许使用 ChatGPT 订阅。请启用订阅权限。", attempt);
        ok = true;
      } catch (error) {
        this.changed(attempt.controller.signal.aborted ? "cancelled" : "failed", attempt.controller.signal.aborted ? "登录已取消或超时。" : `${step}失败：${error instanceof Error ? error.message : "请重试。"}`, attempt);
      } finally { clearTimeout(attempt.timer); if (this.pending === attempt) this.pending = undefined; }
      return page(ok);
    });
  }
  private async json(url: string, init: RequestInit = {}) {
    try {
      const response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.any([init.signal ?? new AbortController().signal, AbortSignal.timeout(15000)]) });
      if (Number(response.headers.get("content-length")) > 1024 * 1024) throw new Error("response too large");
      const data: unknown = await response.json();
      if (!response.ok) throw failure(data, response.status, response.headers.get("x-request-id") ?? undefined);
      return data;
    } catch (error) { if (error instanceof OpenAIError) throw error; if (init.signal?.aborted) throw new Error("操作已取消"); throw new Error("无法连接 OpenAI，请检查网络后重试。"); }
  }
  private metadata() {
    return this.discovery ??= this.json(ISSUER + "/.well-known/openid-configuration").then(value => {
      const config = z.object({ issuer: z.literal(ISSUER), authorization_endpoint: z.literal(AUTHORIZE), token_endpoint: z.literal(TOKEN), jwks_uri: z.string().url(), revocation_endpoint: z.string().url() }).parse(value);
      for (const endpoint of [config.jwks_uri, config.revocation_endpoint]) { const u = new URL(endpoint); if (u.origin !== ISSUER || u.username || u.password || u.hash) throw new Error("OpenAI 身份服务配置无效"); }
      return config;
    }).catch(error => { this.discovery = undefined; if (error instanceof OpenAIError) throw error; throw new Error("无法验证 OpenAI 身份服务配置，请检查网络后重试。"); });
  }
  private async verify(id: string, clientId: string, nonce?: string) {
    const config = await this.metadata();
    this.jwks ??= createRemoteJWKSet(new URL(config.jwks_uri), { timeoutDuration: 15000, [customFetch]: (url, options) => this.fetcher(url, { ...options, redirect: "error" }) });
    try {
      const { payload } = await jwtVerify(id, this.jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256", "ES256"], requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5 });
      if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce) || (payload.azp !== undefined && payload.azp !== clientId) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error("claims");
      return payload;
    } catch { throw new Error("OpenAI 身份验证失败（签名、有效期或账号不匹配），请重新登录。"); }
  }
  private tokenRequest(body: URLSearchParams, signal?: AbortSignal) { return this.json(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal }); }
  private parseTokens(data: unknown, previous?: Tokens): Tokens {
    const parsed = z.object({ access_token: secret, refresh_token: secret.optional(), id_token: secret.optional(), token_type: z.string().refine(v => v.toLowerCase() === "bearer"), expires_in: z.number().positive().max(86400), scope: z.string().max(4000) }).safeParse(data);
    if (!parsed.success || (!previous && !parsed.data.id_token)) throw new Error("OpenAI 返回了不完整的授权凭证，请重新登录。");
    const value = parsed.data;
    // A granted offline scope must have a rotating refresh token; never reuse a consumed one.
    if ((previous?.refresh || value.scope.split(/\s+/).includes("offline_access")) && !value.refresh_token) throw new Error("OpenAI 未返回新的刷新凭证，请重新登录。");
    return { access: value.access_token, refresh: value.refresh_token ?? null, id: value.id_token ?? previous!.id, scopes: value.scope.split(/\s+/).filter(Boolean), expiresAt: Date.now() + value.expires_in * 1000 };
  }
  private async credential(id: string): Promise<string> {
    return this.serial(async () => {
      if (!this.available) throw new Error("ChatGPT 凭证暂不可用，请检查钥匙串并重启应用");
      if (this.stopped || this.signingOut.has(id)) throw new Error("此 ChatGPT 连接正在退出");
      let p = this.get(id);
      if (!p.tokens) throw new Error("请在设置中重新登录 ChatGPT");
      if (p.tokens.expiresAt <= Date.now() + 60000) {
        if (!p.tokens.refresh) throw new Error("ChatGPT 登录已过期，请重新登录");
        let exchanged = false;
        try {
          const data = await this.tokenRequest(new URLSearchParams({ grant_type: "refresh_token", client_id: p.clientId, refresh_token: p.tokens.refresh, resource: RESOURCE }));
          exchanged = true;
          const renewed = this.parseTokens(data, p.tokens);
          if (renewed.id !== p.tokens.id) { const identity = await this.verify(renewed.id, p.clientId); if (identity.sub !== p.subject) throw new Error("刷新返回了不同的 ChatGPT 账号，请重新登录"); }
          p = { ...p, tokens: renewed };
          await this.persist({ ...this.vault, profiles: this.vault.profiles.map(item => item.id === id ? p : item) });
        } catch (error) {
          if (exchanged || (error instanceof OpenAIError && terminalRefresh.has(error.code))) {
            // A successful refresh consumes the old token even if validation or storage then fails.
            const invalidated = { ...this.vault, profiles: this.vault.profiles.map(item => item.id === id ? { ...item, tokens: null } : item) };
            try { await this.persist(invalidated); }
            catch { this.vault = invalidated; this.available = false; this.message = "无法更新钥匙串，已停止使用此凭证。请检查钥匙串后重启并重新登录。"; this.services.changed(); }
            this.catalogs.delete(id);
          }
          throw error;
        }
      }
      if (!p.tokens!.scopes.includes(DIRECT)) throw new Error("此账号尚未允许使用 ChatGPT 订阅，请在设置中启用权限");
      return p.tokens!.access;
    });
  }
  async select(id: string) {
    await this.serial(async () => { this.get(id); await this.persist({ ...this.vault, activeProfileId: id }); });
    return this.status();
  }
  async acknowledge(id: string) {
    await this.serial(async () => { this.get(id); await this.persist({ ...this.vault, profiles: this.vault.profiles.map(p => p.id === id ? { ...p, welcomeSeen: true } : p) }); });
    return this.status();
  }
  async catalog(id: string): Promise<ChatGPTModel[]> {
    const token = await this.credential(id);
    const data = await this.json(RESOURCE + "/models", { headers: { authorization: "Bearer " + token } });
    const result = z.object({ models: z.array(z.object({ slug: z.string().min(1).max(200), display_name: z.string().min(1).max(200), visibility: z.string() })).max(500) }).safeParse(data);
    if (!result.success) throw new Error("OpenAI 模型目录格式发生变化，请稍后重试。");
    const items = result.data.models.filter(m => m.visibility === "list").map(m => ({ id: m.slug, name: m.display_name }));
    if (!this.connected(id)) throw new Error("ChatGPT 连接已断开");
    this.catalogs.set(id, items); this.blocked.delete(id);
    return items;
  }
  async model(id: string, modelId: string) {
    const models = this.catalogs.get(id) ?? await this.catalog(id);
    const model = models.find(m => m.id === modelId);
    if (!model) throw new Error("该模型不在此 ChatGPT 账号的可用目录中，请刷新模型列表");
    return model;
  }
  async stream(id: string, modelId: string, request: ModelRequest, signal: AbortSignal, append: (text: string) => void) {
    if (this.blocked.has(id)) throw new Error(messages.subscription_sharing_usage_limit_exceeded + "确认后请在设置中刷新模型。");
    const controller = new AbortController(); this.requests.set(controller, id);
    const combined = AbortSignal.any([signal, controller.signal]);
    try {
      await this.model(id, modelId);
      const access = await this.credential(id); combined.throwIfAborted();
      let response: Response;
      try { response = await this.fetcher(RESOURCE + "/responses", { method: "POST", redirect: "error", signal: combined, headers: { authorization: "Bearer " + access, "content-type": "application/json" }, body: JSON.stringify({ model: modelId, input: [{ role: "user", content: request.prompt }], ...(request.system ? { instructions: request.system } : {}), store: false, stream: true }) }); }
      catch { throw new Error("ChatGPT 请求中断，请检查网络或稍后重试。"); }
      const requestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.ok) throw failure(await response.json().catch(() => null), response.status, requestId);
      if (!response.body) throw new Error("ChatGPT 返回了空响应");
      let completed = false; let length = 0;
      for await (const data of readSSE(response.body)) {
        combined.throwIfAborted();
        let event: { type?: string; delta?: string; response?: { error?: unknown }; error?: unknown };
        try { event = JSON.parse(data); } catch { throw new Error("ChatGPT 返回了无效的流式消息"); }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") { append(event.delta); length += event.delta.length; combined.throwIfAborted(); }
        if (event.type === "response.failed") throw failure({ error: event.response?.error }, undefined, requestId);
        if (event.type === "error" || event.error) throw failure(event, undefined, requestId);
        if (event.type === "response.incomplete") throw new Error("ChatGPT 未完整生成结果，请缩短请求后重试");
        if (event.type === "response.completed") { completed = true; break; }
      }
      if (!completed) throw new Error("ChatGPT 连接在生成完成前中断");
      if (!length) throw new Error("ChatGPT 未返回文本内容");
    } catch (error) {
      if (error instanceof OpenAIError && error.code === "subscription_sharing_usage_limit_exceeded") this.blocked.add(id);
      if (combined.aborted) throw new Error("ChatGPT 请求已停止");
      throw error;
    } finally { controller.abort(); this.requests.delete(controller); }
  }
  async signOut(id: string) {
    this.get(id); this.signingOut.add(id); this.services.changed();
    for (const [controller, profileId] of this.requests) if (profileId === id) controller.abort();
    if (this.pending?.profileId === id) await this.cancel(this.pending.id);
    try { return await this.serial(async () => {
      const p = this.get(id); let revoked = !p.tokens?.refresh;
      if (p.tokens?.refresh) for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const config = await this.metadata();
          const result = await this.fetcher(config.revocation_endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: p.tokens.refresh, token_type_hint: "refresh_token", client_id: p.clientId }) });
          await result.body?.cancel(); revoked = result.status === 200;
          if (revoked || result.status < 500) break;
        } catch { /* Keep token until retry, never log it. */ }
        if (!attempt) await Bun.sleep(400);
      }
      await this.persist({ ...this.vault, profiles: this.vault.profiles.map(item => item.id === id ? { ...item, tokens: null } : item) });
      this.catalogs.delete(id); this.blocked.delete(id);
      this.message = revoked ? "已退出 ChatGPT，保留账号注册供下次登录。" : "已在本机退出，但未能确认远程撤销。请到 ChatGPT 设置 → 用量中断开麻辣烫。";
      this.services.changed(); return this.status();
    }); } finally { this.signingOut.delete(id); this.services.changed(); }
  }
  async stop() { this.stopped = true; if (this.pending) await this.cancel(this.pending.id); for (const controller of this.requests.keys()) controller.abort(); await this.queue; }
}
