import {
  Bell,
  Check,
  CircleAlert,
  Clipboard,
  Database,
  FileImage,
  FolderOpen,
  KeyRound,
  Monitor,
  RefreshCw,
  Save,
  PanelsTopLeft,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppEvent, CapabilitySnapshot, ShowcaseSettings } from "../../shared/contracts";
import { connectEvents, errorMessage, jsonRequest, requestJSON } from "../api";
import { Alert, Button, Spinner } from "../components/common";
import { Shell } from "../components/shell";

const actions = [
  { id: "request-screen-capture", label: "申请截图权限", icon: Monitor },
  { id: "request-notifications", label: "申请通知权限", icon: Bell },
  { id: "send-notification", label: "发送测试通知", icon: Bell },
  { id: "choose-file", label: "打开文件面板", icon: FolderOpen },
  { id: "choose-directory", label: "打开目录面板", icon: FolderOpen },
  { id: "choose-save", label: "打开保存面板", icon: Save },
  { id: "copy-text", label: "写入剪贴板", icon: Clipboard },
  { id: "copy-latest-image", label: "复制最近截图", icon: FileImage },
  { id: "keychain-roundtrip", label: "验证 Keychain", icon: KeyRound },
  { id: "open-secondary-window", label: "打开第二窗口", icon: PanelsTopLeft },
];

type ShortcutModifier = ShowcaseSettings["searchShortcut"]["modifiers"][number];
const shortcutModifiers: ShortcutModifier[] = ["command", "option", "control", "shift"];

function parseModifiers(value: string): ShortcutModifier[] {
  return value
    .toLowerCase()
    .split(/[+,\s]+/)
    .filter((modifier): modifier is ShortcutModifier =>
      shortcutModifiers.includes(modifier as ShortcutModifier),
    );
}

export function CapabilitiesView() {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<ShowcaseSettings | null>(null);
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting">(
    "connecting",
  );
  const reload = useCallback(async () => {
    try {
      const [nextSnapshot, nextSettings] = await Promise.all([
        requestJSON<CapabilitySnapshot>("/api/capabilities"),
        requestJSON<{ settings: ShowcaseSettings }>("/api/settings"),
      ]);
      setSnapshot(nextSnapshot);
      setSettings(nextSettings.settings);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void reload();
    return connectEvents((event: AppEvent) => {
      if (event.type === "capabilities.changed") void reload();
      if (event.type === "connection.changed") setConnection(event.state);
    });
  }, [reload]);

  const run = async (action: string) => {
    setWorking(action);
    setError("");
    setMessage("");
    try {
      const value = await requestJSON<{ result: unknown }>(
        "/api/capabilities/actions",
        jsonRequest("POST", { action }),
      );
      setMessage(
        typeof value.result === "object" ? JSON.stringify(value.result) : String(value.result),
      );
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking("");
    }
  };

  const saveSettings = async () => {
    if (settings === null) return;
    setWorking("settings");
    setError("");
    try {
      const value = await requestJSON<{ settings: ShowcaseSettings }>(
        "/api/settings",
        jsonRequest("PUT", settings),
      );
      setSettings(value.settings);
      setMessage("设置已保存并生效");
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setWorking("");
    }
  };

  return (
    <Shell
      title="能力中心"
      subtitle="查看权限、原生状态，并手动验证每条 Host 调用链"
      actions={
        <Button onClick={() => void reload()}>
          <RefreshCw size={15} />
          刷新状态
        </Button>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {message ? <Alert tone="info">验证结果：{message}</Alert> : null}
      {snapshot === null ? (
        <Spinner />
      ) : (
        <>
          <section className="status-grid">
            <div>
              <span>
                <Database size={17} />
              </span>
              <strong>常驻 Backend</strong>
              <small>SQLite 与 HTTP/WS 已就绪</small>
            </div>
            <div>
              <span>
                <Monitor size={17} />
              </span>
              <strong>{snapshot.screens.length} 台显示器</strong>
              <small>{snapshot.windows.length} 个已创建窗口</small>
            </div>
            <div>
              <span>
                <Check size={17} />
              </span>
              <strong>{snapshot.app.statusItemVisible ? "状态栏可见" : "状态栏隐藏"}</strong>
              <small>{snapshot.app.dockVisible ? "Dock 可见" : "仅状态栏模式"}</small>
            </div>
            <div>
              <span>
                {connection === "connected" ? <Check size={17} /> : <RefreshCw size={17} />}
              </span>
              <strong>
                {connection === "connected" ? "WebSocket 已连接" : "WebSocket 重连中"}
              </strong>
              <small>{connection}</small>
            </div>
          </section>
          <section className="capability-list">
            <header>
              <h2>原生能力</h2>
              <span>{snapshot.shortcuts.detail}</span>
            </header>
            {snapshot.items.map((item) => (
              <article key={item.id}>
                <span className={`capability-status ${item.status}`}>
                  {item.status === "authorized" || item.status === "available" ? (
                    <Check size={14} />
                  ) : (
                    <CircleAlert size={14} />
                  )}
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.detail}</small>
                </div>
                <code>{item.status}</code>
              </article>
            ))}
          </section>
          <section>
            <h2 className="section-title">交互式验证</h2>
            <div className="action-grid">
              {actions.map(({ id, label, icon: Icon }) => (
                <Button key={id} loading={working === id} onClick={() => void run(id)}>
                  <Icon size={15} />
                  {label}
                </Button>
              ))}
            </div>
          </section>
          {settings ? (
            <section className="settings-panel">
              <h2>快捷键与截图保留</h2>
              <div className="settings-grid">
                <label>
                  搜索按键
                  <input
                    value={settings.searchShortcut.key}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        searchShortcut: { ...settings.searchShortcut, key: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  区域截图按键
                  <input
                    value={settings.captureShortcut.key}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        captureShortcut: { ...settings.captureShortcut, key: event.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  搜索修饰键
                  <input
                    value={settings.searchShortcut.modifiers.join("+")}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        searchShortcut: {
                          ...settings.searchShortcut,
                          modifiers: parseModifiers(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  截图修饰键
                  <input
                    value={settings.captureShortcut.modifiers.join("+")}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        captureShortcut: {
                          ...settings.captureShortcut,
                          modifiers: parseModifiers(event.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  保留天数
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={settings.screenshotMaxAgeDays}
                    onChange={(event) =>
                      setSettings({ ...settings, screenshotMaxAgeDays: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  最多截图
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={settings.screenshotMaxCount}
                    onChange={(event) =>
                      setSettings({ ...settings, screenshotMaxCount: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <p>修饰键可用 command / option / control / shift；注册冲突时保留上次成功配置。</p>
              <Button
                className="primary"
                loading={working === "settings"}
                onClick={() => void saveSettings()}
              >
                保存设置
              </Button>
            </section>
          ) : null}
          <section className="screen-table">
            <h2>显示器坐标</h2>
            {snapshot.screens.map((screen) => (
              <div key={screen.id}>
                <span>
                  <Monitor size={15} />
                  {screen.name}
                  {screen.main ? "（主屏）" : ""}
                </span>
                <code>
                  x {screen.frame.x} · y {screen.frame.y} · {screen.frame.width} ×{" "}
                  {screen.frame.height} · @{screen.scaleFactor}x
                </code>
              </div>
            ))}
          </section>
        </>
      )}
    </Shell>
  );
}
