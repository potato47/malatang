import React, { useEffect, useState } from "react";
import { Badge, Button, Field } from "@malatang/sdk/ui";
import type { ModelInfo, ProviderPreset, PresetModel } from "@malatang/sdk/types";
import ChatGPTConnection from "./ChatGPTConnection";
import { app } from "./bridge";

const blank = (preset = "openai") => ({ name: "", provider: "OpenAI Compatible", preset, model: "", baseURL: "", apiKey: "", clearApiKey: false, options: {} as Record<string, string> });

export default function ModelSettings() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [catalog, setCatalog] = useState<PresetModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<ModelInfo | null>(null);
  const [editor, setEditor] = useState(false);
  const [search, setSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const [items, presets] = await Promise.all([app.call("models.list", {}), app.call("models.providers", {})]);
        if (live && current === generation) { setModels(items); setProviders(presets); setLoaded(true); setLoadError(""); }
      } catch (e) { if (live && current === generation) setLoadError(String(e)); }
    };
    const off = app.on("models.changed", () => void refresh());
    const reconnect = app.onReconnect(() => void refresh());
    void refresh();
    return () => { live = false; off(); reconnect(); };
  }, []);

  useEffect(() => {
    let live = true;
    setCatalog([]);
    setCatalogLoaded(false);
    if (!editor || !form.preset) { setCatalogLoading(false); return; }
    setCatalogLoading(true);
    void app.call("models.catalog", { providerId: form.preset }).then(items => { if (live) { setCatalog(items); setCatalogLoaded(true); } })
      .catch(e => { if (live) setError(String(e)); }).finally(() => { if (live) setCatalogLoading(false); });
    return () => { live = false; };
  }, [form.preset, editor]);

  const provider = providers.find(item => item.id === form.preset);
  const selected = catalog.find(item => item.id === form.model);
  const missingModel = Boolean(form.preset && form.model && catalogLoaded && !selected);
  const supported = !form.preset || Boolean(provider?.apiKeySupported && provider.modelCount);
  const sameConnection = editing && (editing.preset ?? "") === form.preset && editing.baseURL === form.baseURL.trim().replace(/\/+$/, "") && (form.preset || editing.provider === form.provider);
  const keptKey = Boolean(editing?.hasApiKey && sameConnection && !form.clearApiKey);
  const filteredCatalog = catalog.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(modelSearch.toLowerCase()) || item.id === form.model);
  const begin = (preset = "openai") => { setEditing(null); setForm(blank(preset)); setModelSearch(""); setError(""); setSuccess(""); setEditor(true); };
  const edit = (model: ModelInfo) => {
    setEditing(model); setForm({ name: model.name, provider: model.provider, preset: model.preset ?? "", model: model.model, baseURL: model.baseURL, apiKey: "", clearApiKey: false, options: { ...model.options } });
    setModelSearch(""); setError(""); setSuccess(""); setEditor(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await app.call("models.save", { ...form, preset: form.preset || null, name: form.name.trim() || (selected?.name || form.model).slice(0, 100), provider: provider?.name ?? form.provider, ...(editing ? { id: editing.id } : {}) });
      setModels(await app.call("models.list", {})); setEditor(false); setForm(blank()); setEditing(null);
      setSuccess("模型已保存，可在插件中选择。首次调用时会验证连接。");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError(""); setSuccess("");
    try { await app.call("models.remove", { id }); setModels(await app.call("models.list", {})); setRemoveId(null); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return <div className="settings-page">
    {editor ? <>
      <Button variant="ghost" className="settings-back" disabled={busy} onClick={() => { setEditor(false); setError(""); }}>← 返回模型列表</Button>
      <div className="settings-heading"><div><h1>{editing ? "编辑模型" : "添加模型"}</h1><p>选择服务商和模型，配置一次，所有插件共享。</p></div><Badge>{form.preset ? "Pi 预设" : "自定义服务"}</Badge></div>
      {(error || loadError) && <p className="settings-feedback m-error" role="alert">{error || loadError}</p>}
      <form className="model-editor" onSubmit={event => void save(event)}><fieldset disabled={busy}>
        <section className="model-form-section"><h2><span>1</span>选择模型</h2>
          <Field label="服务商"><select aria-label="服务商" value={form.preset} onChange={e => { setForm({ ...blank(e.target.value), baseURL: e.target.value ? "" : "https://api.openai.com/v1" }); setModelSearch(""); setError(""); }}>
            <optgroup label={`Pi 预设 · ${providers.length} 个服务商`}>{providers.map(item => <option value={item.id} key={item.id}>{item.name}{!item.apiKeySupported ? " · 需要登录" : !item.modelCount ? " · 无文本模型" : ""}</option>)}</optgroup><option value="">自定义 OpenAI 兼容服务</option>
          </select></Field>
          {provider?.notice && <p className="provider-notice">{provider.notice}</p>}
          {form.preset ? <>
            <Field label="查找预设模型"><input type="search" aria-label="查找预设模型" placeholder="搜索模型名称或 ID" value={modelSearch} onChange={e => setModelSearch(e.target.value)} /></Field>
            <Field label="模型" hint={catalogLoading ? "正在加载模型目录…" : `${catalog.length} 个 Pi 预设文本模型`}><select aria-label="预设模型" required value={form.model} disabled={catalogLoading || !supported} onChange={e => setForm({ ...form, model: e.target.value })}>
              <option value="">{catalogLoading ? "正在加载…" : "选择一个模型"}</option>{missingModel && <option value={form.model} disabled>{form.model} · 已不在目录中</option>}{filteredCatalog.map(item => <option value={item.id} key={item.id}>{item.name} · {item.id}</option>)}
            </select></Field>
            {missingModel && <p className="provider-notice" role="status">此模型已不在当前服务商目录中。原配置已保留，请重新选择模型后保存。</p>}
            {selected && <div className="model-capabilities"><Badge>{Intl.NumberFormat("en", { notation: "compact" }).format(selected.contextWindow)} 上下文</Badge>{selected.reasoning && <Badge>支持推理</Badge>}<span>{selected.id}</span></div>}
          </> : <div className="form-columns"><Field label="服务商名称"><input aria-label="自定义服务商名称" required maxLength={100} value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} /></Field><Field label="模型 ID"><input aria-label="模型 ID" required maxLength={200} placeholder="服务商提供的 model ID" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></Field></div>}
          <Field label="显示名称" hint="可选，留空使用模型名称。"><input aria-label="显示名称" maxLength={100} placeholder={selected?.name || "例如：日常写作"} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        </section>
        <section className="model-form-section"><h2><span>2</span>连接配置</h2>
          <Field label={provider?.id === "amazon-bedrock" ? "Bearer Token" : provider?.id === "github-copilot" ? "Copilot Token" : "API Key"} hint={keptKey ? "已保存密钥；留空保留，填写新值可替换。" : editing?.hasApiKey && !sameConnection ? "服务商或地址已变化，请重新填写密钥。" : "密钥仅保存在本机宿主，不会返回到插件或配置页面。"}>
            <input type="password" aria-label="API Key" autoComplete="new-password" disabled={form.clearApiKey || !supported} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={keptKey ? "已配置 · 留空保留" : "填写 API Key 或 Token"} />
          </Field>
          {editing?.hasApiKey && <label className="clear-key"><input type="checkbox" checked={form.clearApiKey} onChange={e => setForm({ ...form, clearApiKey: e.target.checked })} />清除已保存的密钥</label>}
          {provider?.fields.map(field => <Field key={field.key} label={field.label}><input aria-label={field.label} required={field.required} maxLength={300} placeholder={field.placeholder} value={form.options[field.key] ?? ""} onChange={e => setForm({ ...form, options: { ...form.options, [field.key]: e.target.value } })} /></Field>)}
          <details className="connection-options" open={!form.preset || form.preset === "azure-openai-responses" || undefined} key={form.preset}><summary>API 地址{form.preset && form.preset !== "azure-openai-responses" ? " · 默认使用服务商预设" : ""}</summary>
            <Field label="API Base URL" hint={form.preset ? "留空使用所选模型的预设地址；代理或专属端点可在此覆盖。" : "填写 API 根地址，宿主使用 Chat Completions 协议。"}><input type="url" aria-label="API Base URL" required={!form.preset || form.preset === "azure-openai-responses"} placeholder={form.preset === "azure-openai-responses" ? "https://your-resource.openai.azure.com" : selected?.baseURL || "https://api.example.com/v1"} value={form.baseURL} onChange={e => setForm({ ...form, baseURL: e.target.value })} /></Field>
          </details>
        </section>
        <div className="model-editor-footer"><span>保存配置不会发起模型调用。</span><Button type="submit" disabled={busy || catalogLoading || !supported || !form.model || Boolean(form.preset && !selected)}>{busy ? "保存中…" : "保存模型"}</Button></div>
      </fieldset></form>
    </> : <>
      <div className="settings-heading"><div><h1>模型服务</h1><p>连接你常用的模型，让每个插件都能使用。</p></div><Button disabled={!loaded} onClick={() => begin()}>＋ 添加模型</Button></div>
      {(error || loadError) && <p className="settings-feedback m-error" role="alert">{error || loadError}</p>}{success && <p className="settings-feedback model-success" role="status">✓ {success}</p>}
      <ChatGPTConnection />
      <div className="model-list-toolbar"><h2>已添加的模型 <span>{models.length}</span></h2><input type="search" aria-label="搜索已添加模型" placeholder="搜索模型或服务商" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="configured-models">{models.filter(model => `${model.name} ${model.provider} ${model.model}`.toLowerCase().includes(search.toLowerCase())).map(model => <div className="configured-model" key={model.id}>
        <span className="provider-avatar" aria-hidden="true">{model.provider.slice(0, 1).toUpperCase()}</span>
        <div className="configured-model-info"><strong>{model.name}</strong><span>{model.provider} · {model.model}</span></div><Badge tone={model.configured ? "green" : "amber"}>{model.configured ? (model.kind === "chatgpt" ? "ChatGPT 订阅" : "已配置") : model.kind === "chatgpt" ? "需登录授权" : model.kind === "pi" && model.hasApiKey ? "需重新选择模型" : "待配置密钥"}</Badge>
        <div className="configured-model-actions">{removeId === model.id ? <><Button variant="danger" disabled={busy} onClick={() => void remove(model.id)}>确认删除</Button><Button variant="ghost" disabled={busy} onClick={() => setRemoveId(null)}>取消</Button></> : <>{model.kind !== "chatgpt" && <Button variant="ghost" aria-label={`编辑 ${model.name}`} onClick={() => edit(model)}>编辑</Button>}<Button variant="ghost" aria-label={`删除 ${model.name}`} onClick={() => setRemoveId(model.id)}>删除</Button></>}</div>
      </div>)}</div>
      {!loaded && !error && <p className="settings-note">正在读取配置…</p>}
      {loaded && !models.some(model => `${model.name} ${model.provider} ${model.model}`.toLowerCase().includes(search.toLowerCase())) && <p className="settings-note">{models.length ? "没有匹配的模型。" : "尚未添加模型。可从 ChatGPT 账号选择模型，或添加其他模型服务。"}</p>}
      <p className="settings-note">模型的连接与权限会在首次调用时验证。</p>
      <div className="provider-intro"><div><h2>从常用服务商开始</h2><p>内置 Pi 的 {providers.length} 个服务商预设，自动匹配模型与调用协议。</p></div><div className="provider-shortcuts">{["openai", "anthropic", "google", "deepseek", "openrouter", "moonshotai-cn"].map(id => providers.find(provider => provider.id === id)).filter((item): item is ProviderPreset => Boolean(item)).map(provider => <button key={provider.id} onClick={() => begin(provider.id)}><strong>{provider.name}</strong><span>{provider.modelCount} 个预设模型 <b>↗</b></span></button>)}</div></div>
    </>}
  </div>;
}
