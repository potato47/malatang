import React, { useEffect, useState } from "react";
import { createPluginClient } from "@malatang/sdk/client";
import { Badge, Button, PageHeader, Panel } from "@malatang/sdk/ui";
const client = createPluginClient("quick-notes");
export default function QuickNotes() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; client.kv.get("note").then(value => { if (live) { const content = typeof value === "string" ? value : ""; setText(content); setSaved(content); } }).catch(e => live && setError(String(e))).finally(() => live && setLoading(false)); return () => { live = false; }; }, []);
  const save = async () => { setSaving(true); setError(""); try { await client.kv.set("note", text); setSaved(text); } catch (e) { setError(String(e)); } finally { setSaving(false); } };
  return <div className="m-page"><PageHeader eyebrow="YOUR PERSONAL SPACE" title="随手记" description="一闪而过的想法，也值得好好放下。" actions={<Badge tone="green">独立安装的插件</Badge>} /><Panel className="note-panel"><div className="panel-heading"><span>今天，在想什么？</span><Badge>{loading ? "读取中" : text === saved ? "已保存到本机" : "尚未保存"}</Badge></div><textarea aria-label="笔记内容" placeholder="从一个想法开始…" className="note-editor" maxLength={16000} disabled={loading} value={text} onChange={e => setText(e.target.value)} /><div className="panel-footer"><span>{text.length} 字符 · 插件专属 KV</span><Button onClick={() => void save()} disabled={loading || saving || text === saved}>{saving ? "保存中…" : "保存笔记"}</Button></div></Panel>{error && <p className="m-error" role="alert">{error}</p>}<div className="m-callout">这个页面来自独立构建的插件包，使用和内置应用相同的 UI SDK 与存储接口。卸载插件会保留笔记，重新安装后可继续使用。</div></div>;
}
