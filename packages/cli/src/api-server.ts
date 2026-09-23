import {
  assertJSON,
  describeAPI,
  type APIImplementation,
  type InvocationContext,
} from "./business-api.ts";
import type { BackendRouteContext } from "./backend.ts";
import { APIError } from "./api-client.ts";

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
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private readonly closeStreams = new Set<() => void>();
  constructor(
    readonly implementation: APIImplementation,
    readonly context: BackendRouteContext,
  ) {
    this.schema = describeAPI(implementation.contract);
  }
  emit = (event: string, payload: unknown) => {
    const definition = this.implementation.contract.events[event];
    if (!Object.hasOwn(this.implementation.contract.events, event) || !definition)
      throw new APIError("not_found", "Unknown event: " + event);
    const parsed = definition.payload.parse(payload);
    assertJSON(parsed);
    const data = new TextEncoder().encode(
      JSON.stringify({ type: "event", event, payload: parsed }) + "\n",
    );
    if (data.byteLength > 1024 * 1024) throw new APIError("resource_limit", "Event exceeds 1 MiB");
    for (const stream of this.streams) {
      if ((stream.desiredSize ?? 0) < -16) {
        stream.error(new Error("Slow event consumer"));
        this.streams.delete(stream);
      } else stream.enqueue(data);
    }
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
      const body = await request.text();
      // Reading a streaming body yields; an update may have closed admission meanwhile.
      if (!this.ready || this.updating)
        throw new APIError(
          this.updating ? "updating" : "starting",
          "Application is not accepting calls",
        );
      if (body.length > 1024 * 1024)
        throw new APIError("resource_limit", "API request exceeds 1 MiB");
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
      assertJSON(input);
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
          assertJSON(result);
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
    let close = () => {};
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let done = false;
        const send = (value: unknown) => {
          try {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n"));
          } catch {
            close();
          }
        };
        const timer = setInterval(() => send({ type: "heartbeat" }), 1000);
        close = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          this.streams.delete(controller);
          this.closeStreams.delete(close);
          request.signal.removeEventListener("abort", close);
          cleanup();
          try {
            controller.close();
          } catch {}
        };
        if (subscribe) this.streams.add(controller);
        this.closeStreams.add(close);
        request.signal.addEventListener("abort", close, { once: true });
        if (request.signal.aborted) close();
        else send({ type: "ready" });
      },
      cancel: () => close(),
    });
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
    });
  }
}
