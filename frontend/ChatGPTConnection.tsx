import React, { useEffect, useRef, useState } from "react";
import { Badge, Button, Field } from "@semicoder/malatang-sdk/ui";
import { chatGPTLoginProfile, type ChatGPTStatus, type ChatGPTModel } from "../shared/chatgpt";
import { app } from "./bridge";
import ChatGPTAccounts from "./ChatGPTAccounts";

export default function ChatGPTConnection() {
  const [status, setStatus] = useState<ChatGPTStatus | null>(null);
  const [catalog, setCatalog] = useState<ChatGPTModel[]>([]);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const active = chatGPTLoginProfile(status);
  const retry = status?.profiles.find(p => p.id === status.attempt?.profileId);
  const waiting = status?.attempt?.stage === "waiting" || status?.attempt?.stage === "exchanging";
  useEffect(() => {
    alive.current = true; let revision = 0;
    const refresh = async () => { const current = ++revision; try { const result = await app.call("chatgpt.status", {}); if (alive.current && current === revision) setStatus(result); } catch (e) { if (alive.current && current === revision) setError(String(e)); } };
    void refresh(); const off = app.on("chatgpt.changed", () => void refresh()); const modelsOff = app.on("models.changed", () => void refresh()); const reconnect = app.onReconnect(() => void refresh());
    return () => { alive.current = false; generation.current++; off(); modelsOff(); reconnect(); };
  }, []);
  const refreshCatalog = async (profileId: string) => {
    const current = ++generation.current; setLoading(true); setError("");
    try { const items = await app.call("chatgpt.catalog", { profileId }); if (alive.current && current === generation.current) { setCatalog(items); setModel(previous => items.some(m => m.id === previous) ? previous : items[0]?.id ?? ""); } }
    catch (e) { if (alive.current && current === generation.current) setError(String(e)); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    generation.current++; setCatalog([]); setModel(""); setLoading(false); setError(""); setMessage("");
    if (active?.sharing) void refreshCatalog(active.id);
    return () => { generation.current++; };
  }, [active?.id, active?.sharing, status?.attempt?.id, status?.attempt?.stage === "completed"]);
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); const next = await app.call("chatgpt.status", {}); if (alive.current) setStatus(next); return true; }
    catch (e) { if (alive.current) setError(String(e)); return false; }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className="chatgpt-connection" aria-label="ChatGPT 订阅连接">
    <div className="chatgpt-heading"><div><h2>ChatGPT 订阅</h2><p>使用你的 ChatGPT 账号连接 GPT 模型，无需填写 API Key。</p></div><Badge tone={active?.sharing ? "green" : "neutral"}>{active?.sharing ? "已连接" : active?.connected ? "等待订阅授权" : "未连接"}</Badge></div>
    <p className="chatgpt-description">符合条件的 Plus / Pro 账号可使用已授权的订阅额度。模型及用量以当前账号和工作区为准。</p>
    {status && status.profiles.length > 0 && <Field label="当前 ChatGPT 账号" hint={!active?.connected && !waiting ? "点击下方继续登录，也可以切换其他已保存的账号。" : undefined}><select aria-label="当前 ChatGPT 账号" disabled={busy || waiting} value={active?.id ?? ""} onChange={e => void perform(() => app.call("chatgpt.select", { profileId: e.target.value }))}>
      <option value="" disabled>选择已保存的账号</option>{status.profiles.map(p => <option value={p.id} key={p.id}>{p.email ? `${p.email} · ` : ""}{p.label}{p.connected ? "" : " · 需登录"}</option>)}
    </select></Field>}
    {status && status.profiles.length > 0 && <ChatGPTAccounts status={status} busy={busy} perform={perform} />}
    {active?.sharing && !active.welcomeSeen && <div className="chatgpt-welcome" role="status"><strong>You’re using your ChatGPT plan</strong><p>此连接下的模型请求使用你已授权的 ChatGPT 订阅额度。可在 ChatGPT 中管理麻辣烫的使用权限和限额。</p><Button variant="ghost" disabled={busy} onClick={() => void perform(() => app.call("chatgpt.acknowledge", { profileId: active.id }))}>知道了</Button></div>}
    <div className="chatgpt-actions">
      {!waiting && (!active?.sharing || !active) && <Button disabled={busy || !status?.available} onClick={() => void perform(() => app.call("chatgpt.signIn", { ...(active ? { profileId: active.id, consent: active.connected && !active.sharing } : {}) }))}>Continue with ChatGPT</Button>}
      {!waiting && active?.sharing && <Button variant="secondary" disabled={busy} onClick={() => void perform(() => app.call("chatgpt.signIn", { profileId: active.id }))}>重新登录</Button>}
      {!waiting && status && status.profiles.length > 0 && <Button variant="ghost" disabled={busy || !status.available} onClick={() => void perform(() => app.call("chatgpt.signIn", {}))}>＋ 添加账号</Button>}
      {!waiting && active?.connected && <Button variant="ghost" disabled={busy} onClick={() => void perform(() => app.call("chatgpt.signOut", { profileId: active.id }))}>退出登录</Button>}
      {waiting && <><span className="chatgpt-pending" role="status">{status?.attempt?.message}</span><Button variant="secondary" disabled={busy} onClick={() => void perform(() => app.call("chatgpt.cancel", { id: status!.attempt!.id }))}>取消登录</Button></>}
      <Button variant="ghost" onClick={() => void perform(() => app.call("chatgpt.manageUsage", {}))}>管理 ChatGPT 用量 ↗</Button>
    </div>
    {active?.sharing && <div className="chatgpt-model-picker"><Field label="此账号的可用模型" hint={loading ? "正在获取当前账号的模型…" : `${catalog.length} 个可用模型，按 OpenAI 返回顺序显示。`}><select aria-label="ChatGPT 可用模型" value={model} disabled={loading || busy || waiting} onChange={e => setModel(e.target.value)}><option value="" disabled>选择模型</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="chatgpt-actions"><Button disabled={!model || loading || busy || waiting} onClick={() => void perform(async () => { await app.call("chatgpt.addModel", { profileId: active.id, modelId: model }); setMessage("已添加到宿主模型，可在翻译等插件中选择。"); })}>添加到模型列表</Button><Button variant="ghost" disabled={loading || busy || waiting} onClick={() => void refreshCatalog(active.id)}>刷新模型</Button></div><small>Using ChatGPT plan · 添加模型不会发起生成请求</small></div>}
    {error && <p className="settings-feedback m-error" role="alert">{error}</p>}
    {!waiting && status?.attempt && status.attempt.stage !== "completed" && <div className={`settings-feedback ${status.attempt.stage === "failed" ? "m-error" : ""}`} role="status"><p>{status.attempt.message}</p>{retry && <Button variant="secondary" disabled={busy || !status.available} onClick={() => void perform(() => app.call("chatgpt.signIn", { profileId: retry.id, consent: retry.connected && !retry.sharing }))}>重试此账号登录</Button>}</div>}
    {(message || status?.message) && <p className="settings-feedback" role="status">{message || status?.message}</p>}
    {!status && !error && <p className="settings-note">正在读取 ChatGPT 连接…</p>}
  </section>;
}
