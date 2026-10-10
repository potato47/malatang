import {
  assertJSON,
  describeAPI,
  type APIImplementation,
  type InvocationContext,
} from "./business-api.ts";
import type { BackendRouteContext, APIOptions } from "./backend.ts";
import { APIError } from "./api-client.ts";
import {
  API_MAX_BYTES,
  matchesEvent,
  parseEventMatch,
  type EventSubscription,
} from "./api-values.ts";

export function apiError(error: unknown, status = 400): Response {
  return Response.json(
    {
      error: {
        code: error instanceof APIError ? error.code : "invalid_argument",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status },
  );
}
export class APIServer {
  readonly schema;
  updating = false;
  ready = false;
  readonly calls = new Map<string, AbortController>();
  readonly leases = new Set<string>();
  readonly context: BackendRouteContext;
  readonly eventBufferBytes: number;
  private readonly streams = new Set<(data: Uint8Array, event: string, payload: unknown) => void>();
  private readonly closeStreams = new Set<() => void>();
  constructor(
    readonly implementation: APIImplementation,
    context: Omit<BackendRouteContext, "emit">,
    options: APIOptions = {},
  ) {
    this.context = { ...context, emit: this.emit };
    this.eventBufferBytes = options.eventBufferBytes ?? 4 * API_MAX_BYTES;
    if (!Number.isSafeInteger(this.eventBufferBytes) || this.eventBufferBytes < API_MAX_BYTES)
      throw new TypeError("apiOptions.eventBufferBytes must be a safe integer of at least 1 MiB");
    this.schema = describeAPI(implementation.contract);
  }
  emit = (event: string, payload: unknown) => {
    const definition = this.implementation.contract.events[event];
    if (!Object.hasOwn(this.implementation.contract.events, event) || !definition)
      throw new APIError("not_found", "Unknown event: " + event);
    const parsed = definition.payload.parse(payload);
    assertJSON(parsed, `events.${event}.payload`);
    const data = new TextEncoder().encode(
      JSON.stringify({ type: "event", event, payload: parsed }) + "\n",
    );
    if (data.byteLength > 1024 * 1024) throw new APIError("resource_limit", "Event exceeds 1 MiB");
    for (const send of this.streams) send(data, event, parsed);
  };
  async prepare(before?: () => Promise<{ ready: boolean; reason?: string } | void>): Promise<void> {
    this.updating = true;
    try {
      if (this.calls.size || this.leases.size)
        throw new APIError("update_busy", "API calls or scripts are still running");
      const state = await before?.();
      if (state && !state.ready)
        throw new APIError("update_busy", state.reason ?? "Application is busy");
    } catch (error) {
      this.updating = false;
      throw error;
    }
  }
  close() {
    this.ready = false;
    for (const controller of this.calls.values()) controller.abort();
    for (const close of this.closeStreams) close();
  }
  async fetch(request: Request, source: InvocationContext["source"]): Promise<Response> {
    try {
      if (!this.ready || this.updating)
        throw new APIError(
          this.updating ? "updating" : "starting",
          "Application is not accepting calls",
        );
      const path = new URL(request.url).pathname;
      const sessionId = request.headers.get("x-fia-client") ?? "ui";
      if (path === "/schema" && request.method === "GET")
        return Response.json({ result: this.schema });
      if (path === "/events" && request.method === "GET") return this.stream(request);
      if (path === "/lease" && request.method === "GET" && source === "cli") {
        const id = crypto.randomUUID();
        this.leases.add(id);
        return this.stream(
          request,
          () => {
            this.leases.delete(id);
            for (const [key, controller] of this.calls)
              if (key.startsWith(sessionId + ":")) controller.abort();
          },
          false,
        );
      }
      if (path !== "/call" || request.method !== "POST")
        throw new APIError("not_found", "Unknown API endpoint");
      const body = await readRequest(request);
      // Reading a streaming body yields; an update may have closed admission meanwhile.
      if (!this.ready || this.updating)
        throw new APIError(
          this.updating ? "updating" : "starting",
          "Application is not accepting calls",
        );
      const { method, input, requestId } = JSON.parse(body) as {
        method: string;
        input: unknown;
        requestId: string;
      };
      if (typeof method !== "string" || typeof requestId !== "string" || requestId.length > 128)
        throw new APIError("invalid_argument", "Invalid API call");
      const definition = this.implementation.contract.methods[method];
      if (!Object.hasOwn(this.implementation.contract.methods, method) || !definition)
        throw new APIError("not_found", "Unknown method: " + method);
      if (this.calls.size >= 128) throw new APIError("resource_limit", "Too many concurrent calls");
      const key = sessionId + ":" + requestId;
      if (this.calls.has(key)) throw new APIError("conflict", "Duplicate active request");
      assertJSON(input, "input");
      const parsed = definition.input.parse(input);
      const controller = new AbortController();
      this.calls.set(key, controller);
      const abort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      try {
        controller.signal.throwIfAborted();
        let result: unknown;
        try {
          result = await this.implementation.handlers[method]!(parsed as never, {
            ...this.context,
            emit: this.emit,
            source,
            requestId,
            sessionId,
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) throw new APIError("cancelled", "Call cancelled");
          if (error instanceof APIError) throw error;
          throw new APIError(
            "handler_failed",
            error instanceof Error ? error.message : String(error),
          );
        }
        try {
          result = definition.output.parse(result);
          assertJSON(result, "result");
        } catch (error) {
          throw new APIError(
            "invalid_output",
            error instanceof Error ? error.message : String(error),
          );
        }
        const serialized = JSON.stringify({ result });
        if (Buffer.byteLength(serialized) > 1024 * 1024)
          throw new APIError("resource_limit", "API response exceeds 1 MiB");
        return new Response(serialized, { headers: { "content-type": "application/json" } });
      } finally {
        this.calls.delete(key);
        request.signal.removeEventListener("abort", abort);
      }
    } catch (error) {
      return apiError(error);
    }
  }
  private stream(request: Request, cleanup = () => {}, subscribe = true): Response {
    const query = new URL(request.url).searchParams.get("subscriptions");
    let subscriptions: EventSubscription[] | undefined;
    if (subscribe && query !== null) {
      const value: unknown = JSON.parse(query);
      if (!Array.isArray(value))
        throw new APIError("invalid_argument", "Expected subscriptions array");
      subscriptions = value.map((item: unknown) => {
        if (
          !item ||
          typeof item !== "object" ||
          !("event" in item) ||
          typeof item.event !== "string"
        )
          throw new APIError("invalid_argument", "Invalid event subscription");
        if (!Object.hasOwn(this.implementation.contract.events, item.event))
          throw new APIError("not_found", "Unknown event: " + item.event);
        return {
          event: item.event,
          ...("match" in item ? { match: parseEventMatch(item.match) } : {}),
        };
      });
    }
    let close = () => {};
    const body = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let done = false;
          const enqueue = (data: Uint8Array) => {
            if (done) return;
            if (data.byteLength > (controller.desiredSize ?? 0)) {
              controller.error(
                new APIError("resource_limit", "Slow event consumer exceeded byte budget"),
              );
              close();
              return;
            }
            try {
              controller.enqueue(data);
            } catch {
              close();
            }
          };
          const send = (data: Uint8Array, event: string, payload: unknown) => {
            if (!subscriptions || subscriptions.some((item) => matchesEvent(item, event, payload)))
              enqueue(data);
          };
          const frame = (value: unknown) =>
            enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n"));
          const timer = setInterval(() => frame({ type: "heartbeat" }), 1000);
          close = () => {
            if (done) return;
            done = true;
            clearInterval(timer);
            this.streams.delete(send);
            this.closeStreams.delete(close);
            request.signal.removeEventListener("abort", close);
            cleanup();
            try {
              controller.close();
            } catch {}
          };
          if (subscribe) this.streams.add(send);
          this.closeStreams.add(close);
          request.signal.addEventListener("abort", close, { once: true });
          if (request.signal.aborted) close();
          else frame({ type: "ready" });
        },
        cancel: () => close(),
      },
      { highWaterMark: this.eventBufferBytes, size: (chunk) => chunk?.byteLength ?? 0 },
    );
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
    });
  }
}

async function readRequest(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > API_MAX_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new APIError("resource_limit", "API request exceeds 1 MiB");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > API_MAX_BYTES) throw new APIError("resource_limit", "API request exceeds 1 MiB");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
