import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGPT } from "../backend/chatgpt";
import { Store } from "../backend/store";
import { Models } from "../backend/models";
import { chatGPTLoginProfile, chatGPTStatus } from "../shared/chatgpt";

const issuer = "https://auth.openai.com";
const authorize = issuer + "/api/accounts/authorize";
const tokenURL = issuer + "/api/accounts/oauth/token";
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const redirect = "http://127.0.0.1:54873/api/oauth/openai/callback";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const pair = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(pair.publicKey), kid: "test-signing-key", use: "sig", alg: "ES256" };
const signed = (clientId: string, nonce: string, overrides: Record<string, unknown> = {}, key = pair.privateKey) => new SignJWT({ sub: "person-a", email: "person@example.test", nonce, iss: issuer, aud: clientId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...overrides }).setProtectedHeader({ alg: "ES256", kid: jwk.kid }).sign(key);
const events = (items: object[]) => new Response(items.map(item => `data: ${JSON.stringify(item)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
async function fixture() {
  let saved: string | null = null;
  let opened = "";
  const calls: { url: string; init?: RequestInit }[] = [];
  let tokenHandler: (body: URLSearchParams, signal?: AbortSignal | null) => Promise<Response> = async body => {
    const isRefresh = body.get("grant_type") === "refresh_token";
    return Response.json({ access_token: isRefresh ? "rotated-access-secret" : "access-secret", refresh_token: isRefresh ? "rotated-refresh-secret" : "refresh-secret", ...(!isRefresh ? { id_token: await signed(body.get("client_id")!, new URL(opened).searchParams.get("nonce")!) } : {}), token_type: "Bearer", expires_in: 3600, scope });
  };
  let responseHandler = () => events([{ type: "response.output_text.delta", delta: "你好" }, { type: "response.completed", response: { status: "completed" } }]);
  let revokeStatus = 200;
  let vaultFailure = false;
  let modelCount = (_id: string) => 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url === issuer + "/.well-known/openid-configuration") return Response.json({ issuer, authorization_endpoint: authorize, token_endpoint: tokenURL, jwks_uri: issuer + "/.well-known/jwks.json", revocation_endpoint: issuer + "/api/accounts/oauth/revoke" });
    if (url === issuer + "/.well-known/jwks.json") return Response.json({ keys: [jwk] });
    if (url === tokenURL) return tokenHandler(new URLSearchParams(String(init?.body)), init?.signal);
    if (url.endsWith("/oauth/revoke")) return new Response(null, { status: revokeStatus });
    if (url === resource + "/models") return Response.json({ models: [{ slug: "gpt-account-second", display_name: "Second first", visibility: "list" }, { slug: "hidden", display_name: "Do not show", visibility: "hidden" }, { slug: "gpt-account-first", display_name: "First second", visibility: "list" }] });
    if (url === resource + "/responses") return responseHandler();
    throw new Error("Unexpected network request");
  }) as typeof fetch;
  const services = { readSecret: async () => saved, writeSecret: async (value: string) => { if (vaultFailure) throw new Error("private keychain error"); saved = value; }, openURL: async (url: string) => { opened = url; }, redirectURI: redirect, changed: () => {}, fetcher, modelCount: (id: string) => modelCount(id) };
  let auth = new ChatGPT(services); await auth.open(); cleanups.push(() => auth.stop());
  return {
    get auth() { return auth; }, get opened() { return new URL(opened); }, get saved() { return JSON.parse(saved!); }, calls,
    setToken(handler: typeof tokenHandler) { tokenHandler = handler; }, setResponse(handler: typeof responseHandler) { responseHandler = handler; }, setRevoke(status: number) { revokeStatus = status; }, setVaultFailure() { vaultFailure = true; },
    setModelCount(handler: typeof modelCount) { modelCount = handler; },
    async reopen(change?: (value: any) => void) { await auth.stop(); const value = JSON.parse(saved!); change?.(value); saved = JSON.stringify(value); auth = new ChatGPT(services); await auth.open(); },
    async callback(params: Record<string, string> = {}, omitClient = false) { const url = new URL(redirect); url.search = new URLSearchParams({ state: new URL(opened).searchParams.get("state")!, code: "code-only-test", ...(omitClient ? {} : { client_id: "oaiapp_test" }), ...params }).toString(); return auth.callback(new Request(url)); },
    async login() { await auth.signIn(); expect((await this.callback()).status).toBe(200); return auth.status().activeProfileId!; },
  };
}

test("dynamic registration uses persisted host ID, PKCE, issued client and verified identity; API never returns tokens", async () => {
  const f = await fixture(); await f.auth.signIn(); const query = f.opened.searchParams;
  expect(f.opened.origin + f.opened.pathname).toBe(authorize);
  expect(query.get("client_id")).toBe("dynamic_agent_client"); expect(query.get("agent_name_hint")).toBe("Malatang");
  expect(query.get("redirect_uri")).toBe(redirect); expect(query.get("scope")).toBe(scope); expect(query.get("resource")).toBe(resource);
  expect(query.get("ext_agent_host_id")).toBe(f.saved.hostId); expect(query.get("state")!.length).toBeGreaterThan(40);
  expect((await f.callback()).status).toBe(200);
  const exchange = new URLSearchParams(String(f.calls.find(c => c.url === tokenURL)!.init!.body));
  expect(exchange.get("client_id")).toBe("oaiapp_test"); expect(exchange.get("redirect_uri")).toBe(redirect);
  expect(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url")).toBe(query.get("code_challenge")!);
  const result = chatGPTStatus.parse(f.auth.status()); expect(result.profiles[0]).toMatchObject({ connected: true, sharing: true, email: "person@example.test", welcomeSeen: false });
  expect(JSON.stringify(result)).not.toContain("secret"); expect(JSON.stringify(result)).not.toContain("id_token");
  const hostId = f.saved.hostId; await f.reopen(); await f.auth.signIn(result.activeProfileId!);
  expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_test"); expect(f.opened.searchParams.has("agent_name_hint")).toBe(false); expect(f.opened.searchParams.has("id_token_hint")).toBe(true); expect(f.opened.searchParams.get("ext_agent_host_id")).toBe(hostId);
  expect((await f.callback({}, true)).status).toBe(200); expect(f.auth.status().profiles).toHaveLength(1);
});

test("state, duplicated params, cancellation, access denied and callback replay cannot exchange a code", async () => {
  const f = await fixture(); await f.auth.signIn();
  expect((await f.callback({ state: "wrong" })).status).toBe(400); expect(f.calls).toHaveLength(0);
  const duplicate = redirect + "?" + new URLSearchParams({ state: f.opened.searchParams.get("state")!, code: "one", client_id: "oaiapp_test" }) + "&code=two";
  expect((await f.auth.callback(new Request(duplicate))).status).toBe(400); expect(f.calls).toHaveLength(0);
  await f.auth.cancel(f.auth.status().attempt!.id); expect((await f.callback()).status).toBe(400);
  await f.auth.signIn(); expect((await f.callback({ error: "access_denied", error_description: "untrusted-secret" })).status).toBe(400);
  expect(f.calls).toHaveLength(0); expect(JSON.stringify(f.auth.status())).not.toContain("untrusted");
  await f.auth.signIn(); const results = await Promise.all([f.callback(), f.callback()]); expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  expect(f.calls.filter(c => c.url === tokenURL)).toHaveLength(1);
});

test("issued registration survives failed exchange and is reused without making it active", async () => {
  const f = await fixture(); f.setToken(async () => Response.json({ error: "invalid_grant", error_description: "sensitive-body" }, { status: 400 }));
  await f.auth.signIn(); expect((await f.callback()).status).toBe(400); expect(f.auth.status().activeProfileId).toBeNull();
  const profile = f.auth.status().profiles[0]!; expect(profile.connected).toBe(false); expect(JSON.stringify(f.auth.status())).not.toContain("sensitive");
  await f.reopen(); await f.auth.signIn(profile.id); expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_test");
  expect((await f.callback({ client_id: "dynamic_agent_client" })).status).toBe(400);
});

test("region failures identify code exchange and the UI retry reuses the saved registration, including after restart", async () => {
  const f = await fixture();
  f.setToken(async () => Response.json({ error: { code: "unsupported_country_region_territory", message: "private response details" } }, { status: 403 }));
  await f.auth.signIn(); expect((await f.callback()).status).toBe(400);
  const status = chatGPTStatus.parse(f.auth.status());
  expect(status.attempt!.message).toContain("授权码交换失败");
  expect(status.attempt!.message).toContain("系统代理");
  expect(status.attempt!.message).toContain("HTTP 403");
  expect(status.attempt!.message).not.toContain("private");
  expect(status.activeProfileId).toBeNull();
  const id = status.profiles[0]!.id;
  expect(status.attempt!.profileId).toBe(id);
  expect(chatGPTLoginProfile(status)?.id).toBe(id);
  await f.auth.signIn(chatGPTLoginProfile(status)!.id);
  expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_test");
  expect(f.opened.searchParams.has("agent_name_hint")).toBe(false);
  await f.reopen();
  expect(chatGPTLoginProfile(f.auth.status())?.id).toBe(id);
  expect(f.auth.status().activeProfileId).toBeNull();
  expect(f.auth.status().profiles).toHaveLength(1);
});

test("failed additional login exposes its own retry target without changing the active account", async () => {
  const f = await fixture(); const active = await f.login();
  f.setToken(async () => Response.json({ error: "unsupported_country_region_territory" }, { status: 403 }));
  await f.auth.signIn(); expect((await f.callback({ client_id: "oaiapp_other" })).status).toBe(400);
  const status = f.auth.status();
  expect(status.activeProfileId).toBe(active);
  expect(chatGPTLoginProfile(status)?.id).toBe(active);
  const retry = status.attempt!.profileId!;
  expect(retry).not.toBe(active);
  await f.auth.signIn(retry); expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_other");
  await f.reopen();
  expect(chatGPTLoginProfile(f.auth.status())?.id).toBe(active);
});

test("restart after multiple failed registrations resumes the latest saved login without creating or activating an account", async () => {
  const f = await fixture();
  f.setToken(async () => Response.json({ error: "unsupported_country_region_territory" }, { status: 403 }));
  for (const clientId of ["oaiapp_first", "oaiapp_latest"]) {
    await f.auth.signIn(); expect((await f.callback({ client_id: clientId })).status).toBe(400);
  }
  const latest = f.auth.status().attempt!.profileId!;
  await f.reopen();
  expect(f.auth.status().attempt).toBeNull();
  expect(f.auth.status().activeProfileId).toBeNull();
  const target = chatGPTLoginProfile(f.auth.status());
  expect(target?.id).toBe(latest);
  await f.auth.signIn(target!.id);
  expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_latest");
  expect(f.opened.searchParams.has("agent_name_hint")).toBe(false);
  expect(f.auth.status().profiles).toHaveLength(2);
  expect(f.saved.activeProfileId).toBeNull();
});

test("signature, nonce, audience, issuer, expiry and returning subject must all validate", async () => {
  const f = await fixture(); const id = await f.login(); const original = f.saved.profiles[0].tokens;
  const other = await generateKeyPair("ES256");
  for (const [claims, key] of [[{ nonce: "wrong" }, pair.privateKey], [{ aud: "other-client" }, pair.privateKey], [{ iss: "https://attacker.test" }, pair.privateKey], [{ exp: 1 }, pair.privateKey], [{ sub: "another-person" }, pair.privateKey], [{}, other.privateKey]] as const) {
    f.setToken(async body => Response.json({ access_token: "must-not-save", refresh_token: "must-not-save", id_token: await signed(body.get("client_id")!, f.opened.searchParams.get("nonce")!, claims, key), token_type: "Bearer", expires_in: 3600, scope }));
    await f.auth.signIn(id); expect((await f.callback()).status).toBe(400);
    expect(f.saved.profiles[0].tokens).toEqual(original); expect(f.auth.status().activeProfileId).toBe(id);
  }
  await f.auth.signIn(id); expect((await f.callback({ client_id: "oaiapp_other" })).status).toBe(400); expect(f.saved.profiles[0].clientId).toBe("oaiapp_test");
});

test("identity-only grant stays signed in and cannot call catalog or inference; explicit consent reuses registration", async () => {
  const f = await fixture(); f.setToken(async body => Response.json({ access_token: "identity-access", id_token: await signed(body.get("client_id")!, f.opened.searchParams.get("nonce")!), token_type: "Bearer", expires_in: 3600, scope: "openid profile email" }));
  const id = await f.login(); expect(f.auth.status().profiles[0]).toMatchObject({ connected: true, sharing: false });
  await expect(f.auth.catalog(id)).rejects.toThrow("订阅"); expect(f.calls.some(c => c.url === resource + "/models")).toBe(false);
  await f.auth.signIn(id, true); expect(f.opened.searchParams.get("prompt")).toBe("consent"); expect(f.opened.searchParams.get("client_id")).toBe("oaiapp_test");
});

test("same-email registrations stay separate, selection and model catalogs use the selected account", async () => {
  const f = await fixture(); const first = await f.login(); await f.auth.signIn(); expect((await f.callback({ client_id: "oaiapp_other" })).status).toBe(200);
  expect(f.auth.status().profiles).toHaveLength(2); const second = f.auth.status().activeProfileId; expect(first).not.toBe(second);
  await f.auth.select(first); expect(f.auth.status().activeProfileId).toBe(first);
  const catalog = await f.auth.catalog(first); expect(catalog.map(m => m.id)).toEqual(["gpt-account-second", "gpt-account-first"]);
  await f.auth.acknowledge(first); expect(f.auth.status().profiles[0]!.welcomeSeen).toBe(true); expect(f.auth.status().profiles[1]!.welcomeSeen).toBe(false);
});

test("concurrent requests serialize refresh and atomically rotate credentials using the saved client", async () => {
  const f = await fixture(); const id = await f.login(); await f.reopen(v => { v.profiles[0].tokens.expiresAt = 0; });
  await Promise.all([f.auth.catalog(id), f.auth.catalog(id), f.auth.catalog(id)]);
  const refreshes = f.calls.filter(c => c.url === tokenURL && String(c.init?.body).includes("grant_type=refresh_token")); expect(refreshes).toHaveLength(1);
  const body = new URLSearchParams(String(refreshes[0]!.init!.body)); expect(body.get("client_id")).toBe("oaiapp_test"); expect(body.get("refresh_token")).toBe("refresh-secret"); expect(body.has("scope")).toBe(false);
  expect(f.saved.profiles[0].tokens).toMatchObject({ access: "rotated-access-secret", refresh: "rotated-refresh-secret" });
  expect(f.calls.filter(c => c.url === resource + "/models").every(c => new Headers(c.init!.headers).get("authorization") === "Bearer rotated-access-secret")).toBe(true);
});

test("temporary refresh failure retains credentials, terminal invalidation clears tokens but keeps registration", async () => {
  const f = await fixture(); const id = await f.login(); await f.reopen(v => { v.profiles[0].tokens.expiresAt = 0; });
  f.setToken(async () => { throw new Error("network containing refresh-secret"); }); await expect(f.auth.catalog(id)).rejects.toThrow("网络"); expect(f.saved.profiles[0].tokens.refresh).toBe("refresh-secret");
  f.setToken(async () => Response.json({ error: "refresh_token_reused" }, { status: 400 })); await expect(f.auth.catalog(id)).rejects.toThrow("重新登录"); expect(f.saved.profiles[0].tokens).toBeNull(); expect(f.saved.profiles[0].clientId).toBe("oaiapp_test");
});

test("logout revokes refresh token and removes all local tokens, preserves registration and reports unconfirmed revocation", async () => {
  const f = await fixture(); const id = await f.login(); await f.auth.signOut(id);
  const call = f.calls.find(c => c.url.endsWith("/oauth/revoke"))!; const body = new URLSearchParams(String(call.init!.body));
  expect(body.get("token")).toBe("refresh-secret"); expect(body.get("token_type_hint")).toBe("refresh_token"); expect(body.get("client_id")).toBe("oaiapp_test");
  expect(f.saved.profiles[0].tokens).toBeNull(); expect(f.auth.connected(id)).toBe(false);
  await f.auth.signIn(id); expect(f.opened.searchParams.has("id_token_hint")).toBe(false); expect((await f.callback()).status).toBe(200);
  f.setRevoke(503); const status = await f.auth.signOut(id); expect(status.message).toContain("未能确认远程撤销"); expect(f.saved.profiles[0].tokens).toBeNull();
});

test("subscription inference uses only approved public Responses fields and requires explicit completion", async () => {
  const f = await fixture(); const id = await f.login(); let output = "";
  const run = () => f.auth.stream(id, "gpt-account-second", { modelId: "unused", prompt: "hello", system: "Translate" }, new AbortController().signal, delta => { output += delta; });
  await run(); expect(output).toBe("你好");
  const call = f.calls.find(c => c.url === resource + "/responses")!;
  expect(JSON.parse(String(call.init!.body))).toEqual({ model: "gpt-account-second", input: [{ role: "user", content: "hello" }], instructions: "Translate", store: false, stream: true });
  expect(call.init!.redirect).toBe("error"); expect(new Headers(call.init!.headers).get("authorization")).toBe("Bearer access-secret");
  for (const terminal of [[], [{ type: "response.incomplete" }], [{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable" } } }]]) {
    f.setResponse(() => events([{ type: "response.output_text.delta", delta: "partial" }, ...terminal])); await expect(run()).rejects.toThrow();
  }
  f.setResponse(() => events([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }])); await expect(run()).rejects.toThrow("用量");
  const count = f.calls.length; await expect(run()).rejects.toThrow("用量"); expect(f.calls).toHaveLength(count);
  await f.auth.catalog(id); f.setResponse(() => new Response(JSON.stringify({ detail: "private server details access-secret" }), { status: 403 })); await expect(run()).rejects.toThrow("HTTP 403");
});

test("host model config contains no token, stays tied to its account and invokes ChatGPT from plugin interface", async () => {
  const f = await fixture(); const id = await f.login(); const dir = await mkdtemp(join(tmpdir(), "malatang-chatgpt-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.open(); const models = new Models(store, () => {}, () => {}, fetch, f.auth); cleanups.push(() => models.stop());
  const model = await models.addChatGPTModel(id, "gpt-account-second"); expect(model).toMatchObject({ kind: "chatgpt", configured: true, hasApiKey: false, chatgptProfileId: id }); expect(JSON.stringify(store.value)).not.toContain("secret");
  expect((await models.addChatGPTModel(id, model.model)).id).toBe(model.id);
  await expect(models.save({ id: model.id, name: "bad", provider: "Proxy", model: model.model, baseURL: "https://attacker.test" })).rejects.toThrow("账号绑定");
  const run = await models.start("translate", { modelId: model.id, prompt: "hello" });
  while (models.busy()) await Bun.sleep(5);
  expect(models.get("translate", run.id)).toMatchObject({ output: "你好", status: "completed", demo: false });
  await f.auth.signOut(id); expect(models.list().find(m => m.id === model.id)!.configured).toBe(false);
});

test("cancel during token exchange cannot activate the account; persistence failure is safe", async () => {
  const f = await fixture(); let started!: () => void; const barrier = new Promise<void>(r => { started = r; });
  f.setToken(async (_, signal) => { started(); return await new Promise<Response>((_, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); });
  await f.auth.signIn(); const callback = f.callback(); await barrier; const cancellation = f.auth.cancel(f.auth.status().attempt!.id);
  expect((await callback).status).toBe(400); await cancellation; expect(f.auth.status().activeProfileId).toBeNull(); expect(f.saved.profiles[0].tokens).toBeNull();
  await f.auth.signIn(f.auth.status().profiles[0]!.id); f.setVaultFailure(); f.setToken(async body => Response.json({ access_token: "must-not-leak", refresh_token: "must-not-leak", id_token: await signed(body.get("client_id")!, f.opened.searchParams.get("nonce")!), token_type: "Bearer", expires_in: 3600, scope }));
  expect((await f.callback()).status).toBe(400); expect(f.auth.status().attempt!.message).toContain("钥匙串"); expect(JSON.stringify(f.auth.status())).not.toContain("must-not-leak");
});

test("expired callback and wrong loopback path are rejected before token exchange", async () => {
  const f = await fixture(); await f.auth.signIn();
  const wrong = new URL(f.opened.searchParams.get("redirect_uri")!); wrong.pathname = "/api/oauth/other"; wrong.search = new URLSearchParams({ state: f.opened.searchParams.get("state")!, code: "code", client_id: "oaiapp_test" }).toString();
  expect((await f.auth.callback(new Request(wrong))).status).toBe(400);
  const now = Date.now;
  try { const time = now(); Date.now = () => time + 600001; expect((await f.callback()).status).toBe(400); }
  finally { Date.now = now; }
  expect(f.calls).toHaveLength(0);
});

test("a refresh that cannot be persisted stops using consumed credentials", async () => {
  const f = await fixture(); const id = await f.login(); await f.reopen(v => { v.profiles[0].tokens.expiresAt = 0; }); f.setVaultFailure();
  await expect(f.auth.catalog(id)).rejects.toThrow("钥匙串"); expect(f.auth.status()).toMatchObject({ available: false }); expect(f.auth.connected(id)).toBe(false);
  const count = f.calls.length; await expect(f.auth.catalog(id)).rejects.toThrow("钥匙串"); expect(f.calls).toHaveLength(count);
});

test("cancelling a running subscription stream aborts the upstream request and retains partial output", async () => {
  const f = await fixture(); const id = await f.login(); let cancelled = false;
  f.setResponse(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n')); }, cancel() { cancelled = true; } })));
  const signal = new AbortController(); let output = "";
  await expect(f.auth.stream(id, "gpt-account-second", { modelId: "model", prompt: "hello" }, signal.signal, delta => { output += delta; signal.abort(); })).rejects.toThrow();
  expect(output).toBe("partial"); expect(cancelled).toBe(true);
});

test("rename persists a display label without changing credentials or account-bound model identity", async () => {
  const f = await fixture(); const id = await f.login();
  const dir = await mkdtemp(join(tmpdir(), "malatang-rename-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.open();
  const models = new Models(store, () => {}, () => {}, fetch, f.auth);
  f.setModelCount(id => store.value.models.filter(m => m.chatgptProfileId === id).length);
  const model = await models.addChatGPTModel(id, "gpt-account-second");
  const original = f.saved.profiles[0];
  await f.auth.rename(id, "  我的订阅  ");
  expect(f.saved.profiles[0]).toEqual({ ...original, label: "我的订阅" });
  expect(models.list()[0]).toMatchObject({ id: model.id, provider: "我的订阅", chatgptProfileId: id, configured: true });
  await f.reopen(); expect(f.auth.status().profiles[0]!.label).toBe("我的订阅");
  for (const name of ["  ", "a".repeat(101), "a\nb"]) await expect(f.auth.rename(id, name)).rejects.toThrow();
  await expect(f.auth.rename("missing", "name")).rejects.toThrow("不存在");
  expect(f.saved.profiles[0].label).toBe("我的订阅");
  await expect(f.auth.remove([id])).rejects.toThrow("退出");
  await f.auth.signOut(id);
  expect(f.auth.status().profiles[0]).toMatchObject({ incomplete: false, removalBlockedReason: "此账号仍绑定 1 个模型，请先从模型列表移除。" });
  await expect(f.auth.remove([id])).rejects.toThrow("绑定");
  await models.remove(model.id); await f.auth.remove([id]);
  expect(f.saved.profiles).toHaveLength(0);
});

test("batch cleanup removes only requested registrations, preserves connected identity and frees slots", async () => {
  const f = await fixture(); const active = await f.login(); const original = f.saved.profiles[0];
  f.setToken(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  for (let i = 0; i < 9; i++) { await f.auth.signIn(); await f.callback({ client_id: `oaiapp_failed_${i}` }); }
  const failed = f.auth.status().profiles.filter(p => p.incomplete).map(p => p.id);
  expect(failed).toHaveLength(9);
  await expect(f.auth.signIn()).rejects.toThrow("上限");
  const calls = f.calls.length;
  await expect(f.auth.remove([failed[0]!, active])).rejects.toThrow("退出");
  await expect(f.auth.remove([failed[0]!, "missing"])).rejects.toThrow("不存在");
  expect(f.saved.profiles).toHaveLength(10);
  await f.auth.remove(failed);
  expect(f.auth.status()).toMatchObject({ activeProfileId: active, attempt: null });
  expect(f.saved.profiles).toEqual([original]); expect(f.calls).toHaveLength(calls);
  await f.reopen(); expect(f.auth.status().profiles).toHaveLength(1);
  await f.auth.signIn(); await f.callback({ client_id: "oaiapp_new" });
  expect(f.auth.status().profiles.map(p => p.label)).toEqual(["ChatGPT 账号 1", "ChatGPT 账号 2"]);
});

test("removing selected failed registration falls back to a connected profile and names remain unique after removal", async () => {
  const f = await fixture(); const active = await f.login();
  f.setToken(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  for (const clientId of ["oaiapp_second", "oaiapp_third"]) { await f.auth.signIn(); await f.callback({ client_id: clientId }); }
  const second = f.auth.status().profiles[1]!.id;
  await f.auth.select(second); await f.auth.remove([second]);
  expect(f.auth.status().activeProfileId).toBe(active);
  await f.auth.signIn(); await f.callback({ client_id: "oaiapp_fourth" });
  const labels = f.auth.status().profiles.map(p => p.label);
  expect(new Set(labels).size).toBe(3); expect(labels).toEqual(["ChatGPT 账号 1", "ChatGPT 账号 3", "ChatGPT 账号 2"]);
});

test("deleting all failed records clears selection and retry; Keychain failure never partially applies edits", async () => {
  const f = await fixture(); f.setToken(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  await f.auth.signIn(); await f.callback(); const id = f.auth.status().profiles[0]!.id;
  await f.auth.select(id); await f.auth.remove([id, id]);
  expect(f.auth.status()).toMatchObject({ profiles: [], activeProfileId: null, attempt: null });
  await f.auth.signIn(); await f.callback(); const next = f.auth.status().profiles[0]!.id;
  const before = f.auth.status(); const saved = f.saved;
  f.setVaultFailure();
  await expect(f.auth.rename(next, "changed")).rejects.toThrow("钥匙串");
  await expect(f.auth.remove([next])).rejects.toThrow("钥匙串");
  expect(f.auth.status()).toEqual(before); expect(f.saved).toEqual(saved);
});

test("waiting and exchanging login cannot race account edits or resurrect a removed registration", async () => {
  const f = await fixture(); f.setToken(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
  await f.auth.signIn(); await f.callback(); const id = f.auth.status().profiles[0]!.id;
  await f.auth.signIn(id);
  await expect(f.auth.rename(id, "changed")).rejects.toThrow("取消");
  await expect(f.auth.remove([id])).rejects.toThrow("取消");
  let started!: () => void; const barrier = new Promise<void>(resolve => { started = resolve; });
  f.setToken(async (_, signal) => { started(); return new Promise<Response>((_, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); });
  const callback = f.callback(); await barrier;
  await expect(f.auth.rename(id, "changed")).rejects.toThrow("取消");
  await expect(f.auth.remove([id])).rejects.toThrow("取消");
  const cancellation = f.auth.cancel(f.auth.status().attempt!.id);
  await callback; await cancellation; await f.auth.remove([id]);
  expect((await f.callback()).status).toBe(400); expect(f.saved.profiles).toHaveLength(0);
});
