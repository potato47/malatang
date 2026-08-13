import { Aperture, Clipboard, FolderSearch2, Maximize, Monitor, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AppEvent, ScreenInfo, ScreenshotRecord } from "../../shared/contracts";
import { connectEvents, errorMessage, formatBytes, jsonRequest, requestJSON } from "../api";
import { Alert, Button, EmptyState, Spinner } from "../components/common";
import { Shell } from "../components/shell";

export function ScreenshotsView() {
  const [screenshots, setScreenshots] = useState<ScreenshotRecord[]>([]);
  const [screens, setScreens] = useState<ScreenInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [history, displayList] = await Promise.all([
      requestJSON<{ screenshots: ScreenshotRecord[] }>("/api/screenshots"),
      requestJSON<ScreenInfo[]>("/api/screens"),
    ]);
    setScreenshots(history.screenshots);
    setScreens(displayList);
  }, []);

  useEffect(() => {
    void reload().catch((reason) => setError(errorMessage(reason)));
    return connectEvents((event: AppEvent) => {
      if (event.type === "screenshot.created" || event.type === "screenshots.changed")
        void reload();
      if (event.type === "screenshot.warning") setError(event.message);
    });
  }, [reload]);

  const captureScreen = async (screenId?: string) => {
    setBusy(true);
    setError("");
    try {
      await requestJSON("/api/screenshots", jsonRequest("POST", { mode: "screen", screenId }));
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const action = async (id: string, name: "copy" | "open" | "reveal" | "save-as") => {
    try {
      await requestJSON(`/api/screenshots/${id}/action`, jsonRequest("POST", { action: name }));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("将这张截图移到废纸篓？")) return;
    try {
      await requestJSON(`/api/screenshots/${id}`, jsonRequest("DELETE"));
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Shell
      title="截图"
      subtitle={`${screens.length} 台显示器 · 截图自动保存并复制到剪贴板`}
      actions={
        <>
          <Button loading={busy} onClick={() => void captureScreen()}>
            <Monitor size={15} />
            截取指针所在屏幕
          </Button>
          <Button
            className="primary"
            onClick={() =>
              void requestJSON("/api/screenshots/overlay", jsonRequest("POST")).catch((r) =>
                setError(errorMessage(r)),
              )
            }
          >
            <Aperture size={15} />
            选择区域
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {screens.length > 1 ? (
        <div className="screen-chips">
          {screens.map((screen) => (
            <button key={screen.id} onClick={() => void captureScreen(screen.id)}>
              <Monitor size={14} />
              {screen.name}
              {screen.main ? " · 主屏" : ""}
            </button>
          ))}
        </div>
      ) : null}
      {screenshots.length === 0 ? (
        <EmptyState
          icon={<Aperture size={30} />}
          title="还没有截图"
          detail="截取整屏，或在所有显示器上拖拽选择区域。"
        />
      ) : (
        <div className="screenshot-grid">
          {screenshots.map((item) => (
            <article className="screenshot-card" key={item.id}>
              <div className="screenshot-image">
                <img src={`/api/screenshots/${item.id}/content`} alt={`${item.screenName} 截图`} />
              </div>
              <div className="screenshot-meta">
                <div>
                  <strong>{new Date(item.createdAt).toLocaleString()}</strong>
                  <span>
                    {item.screenName} · {item.mode === "region" ? "区域" : "整屏"} ·{" "}
                    {item.pixelWidth}×{item.pixelHeight} · {formatBytes(item.byteSize)}
                  </span>
                </div>
                <div className="row-actions">
                  <button onClick={() => void action(item.id, "copy")} title="复制图片">
                    <Clipboard size={15} />
                  </button>
                  <button onClick={() => void action(item.id, "open")} title="打开">
                    <Maximize size={15} />
                  </button>
                  <button onClick={() => void action(item.id, "reveal")} title="在访达中显示">
                    <FolderSearch2 size={15} />
                  </button>
                  <button onClick={() => void action(item.id, "save-as")} title="另存副本">
                    <Save size={15} />
                  </button>
                  <button
                    className="danger-icon"
                    onClick={() => void remove(item.id)}
                    title="移到废纸篓"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {busy && screenshots.length === 0 ? <Spinner label="正在截图" /> : null}
    </Shell>
  );
}
