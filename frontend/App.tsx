import React, { useEffect, useState } from "react";
import type { PluginInfo } from "@semicoder/malatang-sdk/types";
import {
  Button,
  EmptyState,
  Loading,
  Page,
  Package,
  Settings as SettingsIcon,
} from "@semicoder/malatang-sdk/ui";
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
      void app
        .call("plugins.list", {})
        .then((items) => {
          if (live && request === generation) {
            setPlugins(items);
            setError("");
            setLoaded(true);
          }
        })
        .catch((e) => live && request === generation && setError(String(e)));
    };
    const off = app.on("plugins.changed", refresh);
    const reconnect = app.onReconnect(refresh);
    refresh();
    return () => {
      live = false;
      off();
      reconnect();
    };
  }, []);

  const active = plugins.filter((plugin) => plugin.enabled && plugin.status === "active");
  const selected = active.find((plugin) => plugin.id === page);
  const title =
    page === "plugins" ? "应用中心" : page === "settings" ? "设置" : (selected?.name ?? "工作台");

  return (
    <div className="app-shell">
      <nav className="activity-bar" aria-label="应用导航">
        <div className="activity-apps">
          {active.map((plugin) => (
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
            <Package aria-hidden="true" />
          </ActivityButton>
          <ActivityButton
            label="设置"
            aria-current={page === "settings" ? "page" : undefined}
            className={`activity-button ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <SettingsIcon aria-hidden="true" />
          </ActivityButton>
        </div>
      </nav>
      <main className="page-area" aria-label={title}>
        {error && (
          <div className="connection-notice" role="alert">
            暂时无法连接宿主：{error}
          </div>
        )}
        <PageSlot visible={page === "plugins"} keepAlive label="应用中心">
          <PluginManager plugins={plugins} open={setPage} />
        </PageSlot>
        <PageSlot visible={page === "settings"} keepAlive label="设置">
          <Settings visible={page === "settings"} />
        </PageSlot>
        {active.map((plugin) => (
          <PageSlot
            pluginId={plugin.id}
            key={pluginPageKey(plugin)}
            visible={page === plugin.id}
            keepAlive={plugin.keepAlive}
            label={plugin.name}
          >
            <PluginPage plugin={plugin} visible={page === plugin.id} />
          </PageSlot>
        ))}
        {!selected &&
          page !== "plugins" &&
          page !== "settings" &&
          (loaded ? (
            <div className="page-scroll">
              <Page>
                <EmptyState
                  title="从一个小应用开始"
                  description="应用已停用或尚未安装，前往应用中心管理。"
                />
                <Button onClick={() => setPage("plugins")}>打开应用中心</Button>
              </Page>
            </div>
          ) : (
            <div className="loading-state">
              {error ? (
                "请等待连接恢复"
              ) : (
                <>
                  <Loading />
                  正在连接工作空间…
                </>
              )}
            </div>
          ))}
      </main>
    </div>
  );
}
