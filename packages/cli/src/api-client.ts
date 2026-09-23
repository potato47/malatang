import type { APIClient, APIContract, CallOptions } from "./business-api.ts";

export class APIError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "APIError";
  }
}
export type APIFetch = (path: string, init?: RequestInit) => Promise<Response>;
export async function readResult(response: Response): Promise<unknown> {
  const value = (await response.json()) as {
    result?: unknown;
    error?: { code: string; message: string; details?: unknown };
  };
  if (value.error) throw new APIError(value.error.code, value.error.message, value.error.details);
  if (!response.ok)
    throw new APIError("protocol_error", "Application rejected the request: " + response.status);
  return value.result;
}
export async function* readLines(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.ok) {
    await readResult(response);
    return;
  }
  if (!response.body) throw new APIError("disconnected", "Missing event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2 * 1024 * 1024)
        throw new APIError("resource_limit", "Event frame exceeds limit");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line) yield JSON.parse(line);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createAPIClient<C extends APIContract>(
  send: APIFetch,
  sessionId: string = crypto.randomUUID(),
): APIClient<C> {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const reconnect = new Set<() => void>();
  const lifetime = new AbortController();
  let events: AbortController | undefined;
  let closed = false;
  const startEvents = () => {
    if (events || closed || !listeners.size) return;
    const controller = (events = new AbortController());
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    void (async () => {
      while (!signal.aborted) {
        try {
          for await (const frame of readLines(
            await send("/events", { signal, headers: { "x-fia-client": sessionId } }),
          )) {
            if (frame.type === "ready") {
              for (const listener of reconnect) listener();
            }
            if (frame.type === "event")
              for (const listener of listeners.get(String(frame.event)) ?? [])
                listener(frame.payload);
          }
        } catch {
          /* Event recovery never replays a business call. */
        }
        if (!signal.aborted)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 500);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      }
    })();
  };
  return {
    async call(method: string, input: unknown, options: CallOptions = {}) {
      if (closed) throw new APIError("disconnected", "Client is closed");
      const timeout = options.timeoutMs ?? 30_000;
      const signals = [
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
        ...(timeout > 0 ? [AbortSignal.timeout(timeout)] : []),
      ];
      const signal = AbortSignal.any(signals);
      try {
        signal.throwIfAborted();
        return await readResult(
          await send("/call", {
            method: "POST",
            signal,
            headers: { "content-type": "application/json", "x-fia-client": sessionId },
            body: JSON.stringify({ method, input, requestId: crypto.randomUUID() }),
          }),
        );
      } catch (error) {
        if (error instanceof APIError) throw error;
        if (signal.aborted)
          throw new APIError(
            signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled",
            "Call cancelled; completed effects are not rolled back",
          );
        throw new APIError(
          "execution_unknown",
          "Connection lost after submitting the call; inspect application state before retrying",
        );
      }
    },
    on(event: string, listener: (payload: unknown) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      startEvents();
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(event);
        if (!listeners.size) {
          events?.abort();
          events = undefined;
        }
      };
    },
    onReconnect(listener: () => void) {
      reconnect.add(listener);
      return () => {
        reconnect.delete(listener);
      };
    },
    close() {
      closed = true;
      lifetime.abort();
      events?.abort();
      listeners.clear();
      reconnect.clear();
    },
  } as APIClient<C>;
}
export function createClient<C extends APIContract>(): APIClient<C> {
  return createAPIClient<C>((path, init) =>
    fetch("/_fia/api" + path, { ...init, credentials: "same-origin" }),
  );
}
