interface BrowserBridge {
  ready: Promise<void>;
  ended(): boolean;
  expire(): void;
  onEnd(listener: () => void): () => void;
  request(path: string, init?: RequestInit): Promise<Response>;
}
export function browserBridge(): BrowserBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as { __FIA_BROWSER__?: BrowserBridge }).__FIA_BROWSER__;
}
export function frontendFetch(path: string, init?: RequestInit): Promise<Response> {
  const bridge = browserBridge();
  return bridge ? bridge.request(path, init) : fetch(path, { ...init, credentials: "same-origin" });
}
/** Open an authenticated application WebSocket; path must be relative to this application. */
export async function openWebSocket(
  path: string,
  protocols?: string | string[],
): Promise<WebSocket> {
  const url = new URL(path, window.location.href);
  if (
    url.origin !== window.location.origin ||
    (url.pathname !== "/_fia/native" && !url.pathname.startsWith("/api/"))
  )
    throw new Error("WebSocket path must be an application endpoint");
  const bridge = browserBridge();
  if (bridge) {
    const response = await bridge.request("/_fia/browser/socket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: url.pathname + url.search }),
    });
    if (!response.ok) throw new Error("WebSocket authorization failed");
    const result = (await response.json()) as { url: string };
    const socket = new WebSocket(result.url, protocols);
    const off = bridge.onEnd(() => socket.close(4001, "Browser authorization ended"));
    socket.addEventListener("close", off, { once: true });
    socket.addEventListener("close", (event) => {
      if (event.code === 4001) bridge.expire();
    });
    return socket;
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url, protocols);
}
