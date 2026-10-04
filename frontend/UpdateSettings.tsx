import React, { useEffect, useRef, useState } from "react";
import { native, type UpdateState } from "@semicoder/fia/client";

const messages: Record<UpdateState["phase"], string> = {
  disabled: "当前构建未启用自动更新", idle: "应用会自动检查更新", checking: "正在检查更新…", available: "发现新版本", downloading: "正在下载更新…", downloaded: "更新已下载，可以安装", applying: "正在安装更新，应用即将重新加载…", current: "当前已是最新版本", failed: "更新未完成，可以重新检查", requiresInstall: "此版本需要下载安装包",
};
export default function UpdateSettings() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [version, setVersion] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const mounted = useRef(false), busy = useRef(false), revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const off = native.on("updates.stateChanged", () => { void refresh(); });
    const focus = () => { void refresh(); }; window.addEventListener("focus", focus);
    async function refresh() {
      const request = ++revision.current;
      try { const [next, info] = await Promise.all([native.updates.state(), native.application.info()]); if (mounted.current && request === revision.current) { setState(next); setVersion(`${info.version}（${info.build}）`); } }
      catch (e) { if (mounted.current && request === revision.current) setError(String(e)); }
    }
    void refresh();
    return () => { mounted.current = false; revision.current++; off(); window.removeEventListener("focus", focus); };
  }, []);
  const act = async (operation: () => Promise<unknown>) => {
    if (busy.current) return; busy.current = true; setPending(true); setError("");
    try { await operation(); if (mounted.current) setState(await native.updates.state()); }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  const working = pending || !state || ["checking", "downloading", "applying"].includes(state.phase);
  return <div className="settings-page"><div className="settings-heading"><div><h1>应用更新</h1><p>当前版本 {version || "读取中…"}</p></div></div>
    <section className="update-card" aria-busy={working}>
      <h2 className="settings-section-title" role="status">{state ? messages[state.phase] : "正在读取更新状态…"}</h2>
      {state?.version && ["available", "downloaded", "requiresInstall"].includes(state.phase) && <p>新版本 {state.version}</p>}
      <div className="update-actions"><button className="m-button" disabled={working || state?.phase === "disabled"} onClick={() => void act(() => native.updates.check())}>检查更新</button>
        {state?.phase === "available" && <button className="m-button primary" disabled={working} onClick={() => void act(() => native.updates.download())}>下载更新</button>}
        {state?.phase === "downloaded" && <button className="m-button primary" disabled={working} onClick={() => void act(() => native.updates.apply())}>安装更新</button>}
        {state?.phase === "requiresInstall" && state.downloadURL && <button className="m-button primary" disabled={working} onClick={() => void act(() => native.system.openURL({ url: state.downloadURL! }))}>下载安装包</button>}
      </div>
      <p className="settings-note">启动时和每 24 小时自动检查更新。更新下载完成后会请你确认；安装前请保存草稿，等待模型、插件和登录任务结束。</p>
      <p className="settings-note">更新失败时保留当前版本；新版本启动失败时自动恢复上一版代码。已保存的数据会保留。</p>
      {(error || state?.message) && <p className="m-error" role="alert">{error || state?.message}</p>}
    </section>
  </div>;
}
