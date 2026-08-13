import type { APIErrorPayload, AppEvent } from "../shared/contracts";

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let payload: APIErrorPayload | null = null;
    try {
      payload = (await response.json()) as APIErrorPayload;
    } catch {
      // Preserve the HTTP status when the body is not JSON.
    }
    throw new RequestError(
      payload?.error.code ?? `HTTP_${response.status}`,
      payload?.error.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      payload?.error.details,
    );
  }
  return (await response.json()) as T;
}

export function jsonRequest(method: "POST" | "PUT" | "DELETE", value?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value ?? {}),
  };
}

export function connectEvents(onEvent: (event: AppEvent) => void): () => void {
  let socket: WebSocket | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const connect = () => {
    if (stopped) return;
    onEvent({ type: "connection.changed", state: socket === null ? "connecting" : "reconnecting" });
    const target = new URL("/ws", location.href);
    target.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(target);
    socket.addEventListener("open", () => {
      onEvent({ type: "connection.changed", state: "connected" });
    });
    socket.addEventListener("message", (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as AppEvent);
      } catch {
        // Ignore malformed application events; the socket remains usable.
      }
    });
    socket.addEventListener("close", () => {
      if (!stopped) {
        onEvent({ type: "connection.changed", state: "reconnecting" });
        timeout = setTimeout(connect, 1_000);
      }
    });
  };
  connect();
  return () => {
    stopped = true;
    if (timeout !== null) clearTimeout(timeout);
    socket?.close();
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

export function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}
