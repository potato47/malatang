import styles from "./page.module.css";
import React, { useEffect, useRef, useState } from "react";
import { createPluginClient } from "@semicoder/malatang-sdk/client";
import type { ModelInfo, ModelRun } from "@semicoder/malatang-sdk/types";
import { Alert, Badge, Button, Field, ModelSelect, Page, PageHeader, Panel, PanelFooter, PanelHeader, Select, Textarea } from "@semicoder/malatang-sdk/ui";
const client = createPluginClient("translate");
const sample = "Good tools disappear into the work. They give ideas room to grow, and make the complicated feel simple.";
const languages = ["简体中文", "English", "日本語", "한국어", "Français"];
const statusLabels = { running: "正在翻译", completed: "翻译完成", cancelled: "已停止", failed: "运行失败" };
export default function Translate() {
  const [text, setText] = useState(sample);
  const [target, setTarget] = useState("简体中文");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [current, setCurrent] = useState<ModelRun | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const selected = useRef<string | null>(null);
  const alive = useRef(true);
  const busy = pending || current?.status === "running";
  const refresh = async () => {
    const items = await client.runs.list();
    if (!alive.current) return;
    setRuns(items);
    const restoring = !selected.current;
    const id = selected.current ?? items.find(item => !item.demo)?.id;
    if (id) {
      selected.current = id;
      const run = await client.runs.get(id);
      if (alive.current && selected.current === id) { setCurrent(previous => previous?.id === id && previous.revision > run.revision ? previous : run); if (restoring) setText(run.input); }
    }
  };
  useEffect(() => {
    alive.current = true;
    const fail = (e: unknown) => alive.current && setError(String(e));
    let modelGeneration = 0;
    const refreshModels = async () => {
      const generation = ++modelGeneration;
      try { const items = await client.models.list(); if (alive.current && generation === modelGeneration) { setModels(items); setModelsLoaded(true); } }
      catch (e) { if (generation === modelGeneration) fail(e); }
    };
    const off = client.runs.onChange(() => { void refresh().catch(fail); });
    const modelsOff = client.models.onChange(() => void refreshModels());
    const reconnect = client.onReconnect(() => { void refresh().catch(fail); void refreshModels(); });
    void refreshModels();
    void client.kv.get("preferences").then(value => { if (alive.current && value && typeof value === "object" && !Array.isArray(value)) { if (typeof value.target === "string") setTarget(value.target); if (typeof value.modelId === "string") setModelId(value.modelId); } }).catch(fail);
    void refresh().catch(fail);
    return () => { alive.current = false; modelGeneration++; off(); modelsOff(); reconnect(); };
  }, []);
  useEffect(() => { if (modelsLoaded && !models.some(model => model.id === modelId && model.configured)) setModelId(models.find(model => model.configured)?.id ?? ""); }, [models, modelsLoaded, modelId]);
  const hasModel = models.some(model => model.id === modelId && model.configured);
  const translate = async () => {
    if (!hasModel || busy || !text.trim()) return;
    setPending(true); setError(""); setCopied(false);
    try {
      const run = await client.invoke<ModelRun>("translate", { text, target, modelId });
      selected.current = run.id; setCurrent(run);
      await refresh();
    } catch (e) { setError(String(e)); } finally { setPending(false); }
  };
  const openRun = async (id: string) => {
    selected.current = id; setError(""); setCopied(false);
    try { const run = await client.runs.get(id); if (selected.current === id) { setCurrent(run); setText(run.input); if (models.some(model => model.id === run.modelId)) setModelId(run.modelId); } } catch (e) { setError(String(e)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(current?.output ?? ""); setCopied(true); } catch { setError("无法访问剪贴板，请选中译文手动复制。"); } };
  return <Page>
    <PageHeader eyebrow="A LITTLE LESS LOST IN TRANSLATION" title="让表达，自在抵达。" description="保留你的意思，也照顾另一种语言的语气。" actions={<Badge>译文 · 内置应用</Badge>} />
    <div className={styles["translation-toolbar"]}><div className={styles["language-flow"]}><span>自动识别语言</span><span className={styles["flow-arrow"]}>→</span><Select aria-label="目标语言" value={target} disabled={busy} onChange={e => setTarget(e.target.value)}>{languages.map(language => <option key={language}>{language}</option>)}</Select></div><ModelSelect aria-label="翻译模型" models={models} value={modelId} disabled={busy} onChange={e => setModelId(e.target.value)} /></div>
    <div className={styles["translation-grid"]}>
      <Panel className={styles["translation-card"]}><PanelHeader><span><i className={styles["tiny-dot"]} />原文</span><Button variant="ghost" disabled={busy} onClick={() => setText(sample)}>载入示例 ↗</Button></PanelHeader><Textarea aria-label="待翻译文本" placeholder="写下或粘贴想翻译的文字…" className={styles["translation-input"]} value={text} maxLength={16000} disabled={busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy && hasModel && text.trim()) { e.preventDefault(); void translate(); } }} /><PanelFooter><span>{text.length.toLocaleString()} / 16,000</span><span>⌘ ↵ 开始翻译</span></PanelFooter></Panel>
      <Panel className={[styles["translation-card"], styles["result-card"]].join(" ")}><PanelHeader><span><i className={[styles["tiny-dot"], styles["accent"]].join(" ")} />译文</span>{current ? <Badge tone={current.status === "failed" ? "error" : current.status === "completed" ? "success" : "neutral"}>{statusLabels[current.status]}</Badge> : <span className={styles["muted"]}>等一个好表达</span>}</PanelHeader><div className={styles["translation-output"]} aria-live="polite" aria-label="翻译结果">{current?.output ? <p>{current.output}{current.status === "running" && <span className={styles["typing-cursor"]} />}</p> : <div className={styles["translation-empty"]}><div className={styles["translation-art"]}><span>A</span><span>文</span><i>✦</i></div><h3>{busy ? "正在寻找合适的表达…" : "另一种语言，同样的你"}</h3><p>译文会在这里，一点点呈现。</p></div>}</div><PanelFooter><span>{current?.demo ? "历史演示记录 · 非真实模型" : current ? `${current.output.length} 字符` : "由宿主模型能力提供支持"}</span><Button variant="ghost" disabled={!current?.output} onClick={() => void copy()}>{copied ? "✓ 已复制" : "复制译文"}</Button></PanelFooter></Panel>
    </div>
    <div className={styles["translation-actions"]}><p><span className={styles["soft-spark"]}>✦</span>{!hasModel ? "请先在「设置 → 模型服务」添加并连接模型。" : "模型由宿主管理，插件无需单独配置 API Key。"}</p>{busy ? <Button variant="secondary" disabled={pending} onClick={() => current && void client.runs.cancel(current.id).then(setCurrent).catch(e => setError(String(e)))}>停止生成</Button> : <Button disabled={!text.trim() || !hasModel} onClick={() => void translate()}>开始翻译 <span>↗</span></Button>}</div>
    {(error || current?.error) && <Alert>{error || current?.error}</Alert>}
    <section className={styles["history-section"]}><div className={styles["section-title"]}><h2>最近的译文 <span>{runs.length.toString().padStart(2, "0")}</span></h2><span>保存在本机</span></div>{runs.length ? <div className={styles["history-list"]}>{runs.slice(0, 5).map(run => <Button variant="ghost" key={run.id} className={`${styles["history-row"]} ${current?.id === run.id ? styles.selected : ""}`} disabled={busy} onClick={() => void openRun(run.id)}><span className={styles["history-icon"]}>文</span><span className={styles["history-content"]}><strong>{run.title}</strong><small>{run.output || statusLabels[run.status]}</small></span><span className={styles["history-date"]}>{new Date(run.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span><span>↗</span></Button>)}</div> : <div className={styles["history-placeholder"]}>每一次表达，都有迹可循。完成的翻译会保留在这里。</div>}</section>
  </Page>;
}
