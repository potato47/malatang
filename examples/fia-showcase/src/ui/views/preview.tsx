import { Clipboard, Download, FolderSearch2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ScreenshotRecord } from "../../shared/contracts";
import { errorMessage, formatBytes, jsonRequest, requestJSON } from "../api";
import { Alert, Button, Spinner } from "../components/common";

export function PreviewView() {
  const id = new URLSearchParams(location.search).get("id") ?? "";
  const [record, setRecord] = useState<ScreenshotRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void requestJSON<{ screenshot: ScreenshotRecord }>(`/api/screenshots/${id}`)
      .then((value) => {
        setRecord(value.screenshot);
        setMessage(value.screenshot.warning ?? "截图已保存并复制到剪贴板");
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [id]);
  const action = async (name: "copy" | "reveal" | "save-as") => {
    try {
      const value = await requestJSON<{ saved?: boolean }>(
        `/api/screenshots/${id}/action`,
        jsonRequest("POST", { action: name }),
      );
      setMessage(
        name === "copy"
          ? "已复制图片"
          : name === "reveal"
            ? "已在访达中显示"
            : value.saved
              ? "副本已保存"
              : "已取消另存为",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  return (
    <main className="preview-window">
      {error ? <Alert>{error}</Alert> : null}
      {record === null ? (
        <Spinner />
      ) : (
        <>
          <div className="preview-shot">
            <img src={`/api/screenshots/${record.id}/content`} alt="最新截图" />
          </div>
          <div className="preview-toolbar">
            <div>
              <strong>
                {record.screenName} · {record.mode === "region" ? "区域截图" : "整屏截图"}
              </strong>
              <span>
                {record.pixelWidth} × {record.pixelHeight} · {formatBytes(record.byteSize)}
              </span>
              <small>{message}</small>
            </div>
            <div>
              <Button onClick={() => void action("copy")}>
                <Clipboard size={14} />
                复制
              </Button>
              <Button onClick={() => void action("reveal")}>
                <FolderSearch2 size={14} />
                定位
              </Button>
              <Button className="primary" onClick={() => void action("save-as")}>
                <Download size={14} />
                另存为
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
