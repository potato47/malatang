import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, jsonRequest, requestJSON } from "../api";

interface Point {
  x: number;
  y: number;
}

export function CaptureView() {
  const parameters = new URLSearchParams(location.search);
  const screenId = parameters.get("screenId") ?? "";
  const screenName = parameters.get("screenName") ?? "显示器";
  const start = useRef<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    document.documentElement.classList.add("capture-page");
    document.body.classList.add("capture-page");
    return () => {
      document.documentElement.classList.remove("capture-page");
      document.body.classList.remove("capture-page");
    };
  }, []);

  const cancel = () =>
    void requestJSON("/api/screenshots/overlay", jsonRequest("DELETE")).catch(() => undefined);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);

  const point = (event: React.PointerEvent): Point => ({ x: event.clientX, y: event.clientY });
  const selection =
    start.current && current
      ? {
          x: Math.min(start.current.x, current.x),
          y: Math.min(start.current.y, current.y),
          width: Math.abs(current.x - start.current.x),
          height: Math.abs(current.y - start.current.y),
        }
      : null;

  const finish = async (event: React.PointerEvent) => {
    if (start.current === null || busy) return;
    const end = point(event);
    const region = {
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    };
    if (region.width < 4 || region.height < 4) {
      start.current = null;
      setCurrent(null);
      return;
    }
    setBusy(true);
    try {
      await requestJSON(
        "/api/screenshots",
        jsonRequest("POST", { screenId, mode: "region", region }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <main
      className="capture-surface"
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
      onPointerDown={(event) => {
        if (!busy) {
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point(event);
          setCurrent(point(event));
          setError("");
        }
      }}
      onPointerMove={(event) => {
        if (start.current !== null && !busy) setCurrent(point(event));
      }}
      onPointerUp={(event) => void finish(event)}
    >
      <div className="capture-instructions">
        <strong>{busy ? "正在截取…" : `拖拽选择区域 · ${screenName}`}</strong>
        <span>Esc 或右键取消</span>
        {error ? <em>{error}</em> : null}
      </div>
      {selection ? (
        <div
          className="capture-selection"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        >
          <span>
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
        </div>
      ) : null}
    </main>
  );
}
