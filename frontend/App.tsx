import React, { useEffect, useState } from "react";
import type { PluginInfo } from "@malatang/sdk/types";
import { EmptyState } from "@malatang/sdk/ui";
import { app } from "./bridge";
import PluginPage, { pluginPageKey } from "./PluginPage";
import PageSlot from "./PageSlot";
import PluginManager from "./PluginManager";
import Settings from "./Settings";
import ThemeControl from "./ThemeControl";
import ActivityButton from "./ActivityButton";

export default function App() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [page, setPage] = useState("translate");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void app.call("plugins.list", {}).then(items => {
        if (live && request === generation) {
          setPlugins(items);
          setError("");
          setLoaded(true);
        }
      }).catch(e => live && request === generation && setError(String(e)));
    };
    const off = app.on("plugins.changed", refresh);
    const reconnect = app.onReconnect(refresh);
    refresh();
    return () => { live = false; off(); reconnect(); };
  }, []);

  const active = plugins.filter(plugin => plugin.enabled && plugin.status === "active");
  const selected = active.find(plugin => plugin.id === page);
  const title = page === "plugins" ? "应用中心" : page === "settings" ? "设置" : selected?.name ?? "工作台";

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label="应用导航">
        <div className="activity-apps">
          {active.map(plugin => (
            <ActivityButton
              key={plugin.id}
              label={plugin.name}
              aria-current={page === plugin.id ? "page" : undefined}
              className={`activity-button ${page === plugin.id ? "active" : ""}`}
              onClick={() => setPage(plugin.id)}
            >
              <span>{plugin.icon}</span>
            </ActivityButton>
          ))}
        </div>
        <div className="activity-tools">
          <ThemeControl />
          <ActivityButton
            label="应用中心"
            aria-current={page === "plugins" ? "page" : undefined}
            className={`activity-button ${page === "plugins" ? "active" : ""}`}
            onClick={() => setPage("plugins")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1.4" /><rect x="14" y="4" width="6" height="6" rx="1.4" />
              <rect x="4" y="14" width="6" height="6" rx="1.4" /><path d="M17 13v8m-4-4h8" />
            </svg>
          </ActivityButton>
          <ActivityButton
            label="设置"
            aria-current={page === "settings" ? "page" : undefined}
            className={`activity-button ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="m9 3-.5 2-2 .9-1.8-.6-2 3.4 1.4 1.5v2.4l-1.4 1.5 2 3.4 1.8-.6 2 .9.5 2h4l.5-2 2-.9 1.8.6 2-3.4-1.4-1.5v-2.4l1.4-1.5-2-3.4-1.8.6-2-.9-.5-2Z" /><circle cx="11" cy="11.4" r="3" />
            </svg>
          </ActivityButton>
        </div>
      </nav>
      <main className="page-area" aria-label={title}>
        {error && <div className="connection-notice" role="alert">暂时无法连接宿主：{error}</div>}
        <PageSlot visible={page === "plugins"} keepAlive label="应用中心">
          <PluginManager plugins={plugins} open={setPage} />
        </PageSlot>
        <PageSlot visible={page === "settings"} keepAlive label="设置">
          <Settings />
        </PageSlot>
        {active.map(plugin => <PageSlot key={pluginPageKey(plugin)} visible={page === plugin.id} keepAlive={plugin.keepAlive} label={plugin.name}>
          <PluginPage plugin={plugin} visible={page === plugin.id} />
        </PageSlot>)}
        {!selected && page !== "plugins" && page !== "settings" && (loaded ? (
          <div className="page-scroll"><div className="m-page">
            <EmptyState title="从一个小应用开始" description="应用已停用或尚未安装，前往应用中心管理。" />
            <button className="m-button primary" onClick={() => setPage("plugins")}>打开应用中心</button>
          </div></div>
        ) : (
          <div className="loading-state">{error ? "请等待连接恢复" : <><span className="loader" />正在连接工作空间…</>}</div>
        ))}
      </main>
    </div>
  );
}
