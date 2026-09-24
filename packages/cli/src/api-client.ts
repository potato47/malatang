import {
  API_MAX_BYTES,
  assertJSON,
  eventPath,
  matchesEvent,
  parseEventMatch,
  type EventSubscription,
  type EventOptions,
} from "./api-values.ts";
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
  // Reading may fail mid-transfer: let the caller preserve execution_unknown in that case.
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {});
    throw new APIError(
      response.status === 401 ? "unauthorized" : "forbidden",
      "Application rejected the request: " + response.status,
    );
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new APIError("protocol_error", "Application returned invalid JSON: " + response.status);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new APIError("protocol_error", "Invalid API response envelope");
  if ("error" in value) {
    const error = value.error;
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      typeof error.code !== "string" ||
      !("message" in error) ||
      typeof error.message !== "string"
    )
      throw new APIError("protocol_error", "Invalid API error envelope");
    throw new APIError(error.code, error.message, "details" in error ? error.details : undefined);
  }
  if (!response.ok || !("result" in value))
    throw new APIError("protocol_error", "Invalid API response: " + response.status);
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
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (new TextEncoder().encode(line + "\n").byteLength > API_MAX_BYTES)
          throw new APIError("resource_limit", "Event frame exceeds 1 MiB");
        if (line) yield JSON.parse(line);
      }
      if (new TextEncoder().encode(buffer).byteLength > API_MAX_BYTES)
        throw new APIError("resource_limit", "Event frame exceeds 1 MiB");
    }
    if (buffer || decoder.decode()) throw new APIError("protocol_error", "Incomplete event frame");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createAPIClient<C extends APIContract>(
  send: APIFetch,
  sessionId: string = crypto.randomUUID(),
): APIClient<C> {
  const listeners = new Map<
    string,
    { subscription: EventSubscription; callbacks: Set<(payload: unknown) => void> }
  >();
  const reconnect = new Set<() => void>();
  const lifetime = new AbortController();
  let events: AbortController | undefined;
  let closed = false;
  const startEvents = () => {
    if (events || closed || !listeners.size) return;
    const subscriptions = [...listeners.values()].map((item) => item.subscription);
    const controller = (events = new AbortController());
    const signal = AbortSignal.any([controller.signal, lifetime.signal]);
    void (async () => {
      while (!signal.aborted) {
        try {
          for await (const frame of readLines(
            await send(eventPath(subscriptions), {
              signal,
              headers: { "x-fia-client": sessionId },
            }),
          )) {
            if (signal.aborted) break;
            if (frame.type === "ready") {
              for (const listener of reconnect) listener();
            }
            if (frame.type === "event")
              for (const { subscription, callbacks } of listeners.values())
                if (matchesEvent(subscription, String(frame.event), frame.payload))
                  for (const listener of callbacks) listener(frame.payload);
          }
        } catch {
          /* Event recovery never replays a business call. */
        }
        if (!signal.aborted)
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, 500);
            signal.addEventListener("abort", finish, { once: true });
            if (signal.aborted) finish();
          });
      }
    })();
  };
  return {
    async call(method: string, input: unknown, options: CallOptions = {}) {
      if (closed) throw new APIError("disconnected", "Client is closed");
      let body: string;
      try {
        assertJSON(input, "input");
        body = JSON.stringify({ method, input, requestId: crypto.randomUUID() });
      } catch (error) {
        throw new APIError(
          "invalid_argument",
          error instanceof Error ? error.message : String(error),
        );
      }
      if (new TextEncoder().encode(body).byteLength > API_MAX_BYTES)
        throw new APIError("resource_limit", "API request exceeds 1 MiB");
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
            body,
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
    on(event: string, listener: (payload: unknown) => void, options: EventOptions = {}) {
      if (closed) throw new APIError("disconnected", "Client is closed");
      const match = options.match === undefined ? undefined : parseEventMatch(options.match);
      const subscription = {
        event,
        ...(match
          ? {
              match: Object.fromEntries(
                Object.entries(match).sort(([a], [b]) => a.localeCompare(b)),
              ),
            }
          : {}),
      };
      const key = JSON.stringify(subscription);
      let entry = listeners.get(key);
      if (!entry) {
        entry = { subscription, callbacks: new Set() };
        listeners.set(key, entry);
        events?.abort();
        events = undefined;
      }
      entry.callbacks.add(listener);
      startEvents();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        entry.callbacks.delete(listener);
        if (!entry.callbacks.size) {
          listeners.delete(key);
          events?.abort();
          events = undefined;
          startEvents();
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
