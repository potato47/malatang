import { afterEach, expect, test } from "bun:test";
import { z as standardZ } from "zod";
import { defineAPI, describeAPI, implementAPI, z } from "../src/business-api.ts";
import { API_MAX_BYTES, assertJSON, eventPath } from "../src/api-values.ts";
import { APIError, createAPIClient, readLines, readResult } from "../src/api-client.ts";
import { APIServer } from "../src/api-server.ts";
import { defineBackend, type BackendNativeClient } from "../src/backend.ts";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const contract = defineAPI({
  methods: {
    echo: { description: "Echo", input: z.string(), output: z.string() },
    optional: {
      description: "Optional",
      input: z.object({}),
      output: z.object({ model: z.string().optional() }),
    },
    invalid: { description: "Invalid output", input: z.object({}), output: z.any() },
  },
  events: {
    changed: {
      description: "Change",
      payload: z.object({ sessionId: z.string(), status: z.string(), data: z.string().optional() }),
    },
    other: { description: "Other", payload: z.number() },
  },
});
function fixture(budget = API_MAX_BYTES) {
  const api = new APIServer(
    implementAPI(contract, {
      echo: (input) => input,
      optional: () => ({ model: undefined }),
      invalid: () => ({ session: { values: [undefined] } }),
    }),
    {
      native: {} as BackendNativeClient,
      app: { name: "test", identifier: "test", codeDirectory: "/tmp", dataDirectory: "/tmp" },
    },
    { eventBufferBytes: budget },
  );
  api.ready = true;
  disposers.push(() => api.close());
  return api;
}
function request(input: unknown) {
  return new Request("http://localhost/call", {
    method: "POST",
    body: JSON.stringify({ method: "echo", input, requestId: crypto.randomUUID() }),
  });
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition timed out");
    await Bun.sleep(5);
  }
}

test("JSON optional object fields are omitted and invalid values report precise paths", () => {
  expect(() => assertJSON({ session: { model: undefined } }, "result")).not.toThrow();
  expect(() => assertJSON({ session: { values: [undefined] } }, "result")).toThrow(
    "result.session.values[0]",
  );
  expect(() => assertJSON(undefined, "result")).toThrow("result");
  const sparse: unknown[] = [];
  sparse.length = 1;
  expect(() => assertJSON(sparse, "input")).toThrow("input[0]");
  for (const value of [NaN, Infinity, 1n, () => {}, new Date()])
    expect(() => assertJSON({ bad: value }, "input")).toThrow("input.bad");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => assertJSON(circular, "input")).toThrow("input.self");
  const shared = { ok: true };
  expect(() => assertJSON({ a: shared, b: shared })).not.toThrow();
});

test("known HTTP errors and malformed responses never become execution_unknown", async () => {
  for (const [status, body, code] of [
    [401, "Unauthorized", "unauthorized"],
    [403, "Forbidden", "forbidden"],
    [401, '{"error":{"code":"unauthorized","message":"No cookie"}}', "unauthorized"],
    [502, "proxy failed", "protocol_error"],
    [200, "{", "protocol_error"],
    [200, "null", "protocol_error"],
    [200, "{}", "protocol_error"],
    [200, '{"error":{}}', "protocol_error"],
  ] as const) {
    const client = createAPIClient(async () => new Response(body, { status }));
    await expect(client.call("echo", "ok")).rejects.toMatchObject({ code });
    client.close();
  }
  const client = createAPIClient(async () => {
    throw new Error("network lost");
  });
  await expect(client.call("echo", "ok")).rejects.toMatchObject({ code: "execution_unknown" });
  await expect(client.call("echo", { value: 1n })).rejects.toMatchObject({
    code: "invalid_argument",
  });
  client.close();
  const interrupted = createAPIClient(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error("reset"));
          },
        }),
      ),
  );
  await expect(interrupted.call("echo", "ok")).rejects.toMatchObject({ code: "execution_unknown" });
  interrupted.close();
});

test("requests use UTF-8 bytes, stop reading oversized streams and preserve optional output", async () => {
  const api = fixture();
  const client = createAPIClient<typeof contract>((path, init) =>
    api.fetch(new Request("http://localhost" + path, init), "ui"),
  );
  disposers.push(() => client.close());
  expect(await client.call("optional", {})).toEqual({});
  await expect(client.call("invalid", {})).rejects.toMatchObject({
    code: "invalid_output",
    message: expect.stringContaining("result.session.values[0]"),
  });
  const oversized = "中".repeat(Math.ceil(API_MAX_BYTES / 3));
  for (const source of ["ui", "cli"] as const)
    await expect(readResult(await api.fetch(request(oversized), source))).rejects.toMatchObject({
      code: "resource_limit",
    });
  expect(await client.call("echo", "中".repeat(1000))).toBe("中".repeat(1000));
  const envelopeBytes = Buffer.byteLength(await request("").text());
  const boundary = request("x".repeat(API_MAX_BYTES - envelopeBytes));
  expect(Buffer.byteLength(await boundary.clone().text())).toBe(API_MAX_BYTES);
  expect((await api.fetch(boundary, "ui")).status).toBe(200);
  let cancelled = false;
  const streamed = new Request("http://localhost/call", {
    method: "POST",
    body: new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(API_MAX_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });
  await expect(readResult(await api.fetch(streamed, "ui"))).rejects.toMatchObject({
    code: "resource_limit",
  });
  expect(cancelled).toBe(true);
});

test("background emit filters on server and byte backpressure isolates slow subscribers", async () => {
  const api = fixture();
  const filtered = readLines(
    await api.fetch(
      new Request(
        "http://localhost" +
          eventPath([{ event: "changed", match: { sessionId: "a", status: "idle" } }]),
      ),
      "ui",
    ),
  );
  expect((await filtered.next()).value?.type).toBe("ready");
  const slowResponse = await api.fetch(new Request("http://localhost/events"), "ui");
  const slow = slowResponse.body!.getReader();
  api.context.emit("changed", { sessionId: "b", status: "idle", data: "x".repeat(600_000) });
  api.context.emit("changed", { sessionId: "b", status: "idle", data: "x".repeat(600_000) });
  await expect(slow.read()).rejects.toMatchObject({ code: "resource_limit" });
  api.context.emit("changed", { sessionId: "a", status: "idle", data: undefined });
  expect((await filtered.next()).value?.payload).toEqual({ sessionId: "a", status: "idle" });
  await filtered.return(undefined);
  expect(() =>
    api.emit("changed", { sessionId: "a", status: "idle", data: "中".repeat(API_MAX_BYTES) }),
  ).toThrow("1 MiB");
  // Cancelled/overflowed subscriptions must not retain heartbeat timers or abort listeners.
  const internals = api as unknown as { streams: Set<unknown>; closeStreams: Set<unknown> };
  expect(internals.streams.size).toBe(0);
  expect(internals.closeStreams.size).toBe(0);
});

test("subscription changes rebuild one shared connection and dispatch each local filter", async () => {
  const api = fixture();
  const paths: string[] = [];
  const client = createAPIClient<typeof contract>((path, init) => {
    paths.push(path);
    return api.fetch(new Request("http://localhost" + path, init), "ui");
  });
  disposers.push(() => client.close());
  let ready = 0;
  const a: string[] = [],
    b: string[] = [];
  client.onReconnect(() => ready++);
  const removeA = client.on("changed", (v) => a.push(v.sessionId), { match: { sessionId: "a" } });
  await until(() => ready === 1);
  const removeB = client.on("changed", (v) => b.push(v.sessionId), { match: { sessionId: "b" } });
  await until(() => ready === 2);
  api.emit("changed", { sessionId: "a", status: "idle" });
  api.emit("changed", { sessionId: "b", status: "idle" });
  await until(() => a.length === 1 && b.length === 1);
  expect(a).toEqual(["a"]);
  expect(b).toEqual(["b"]);
  removeA();
  await until(() => ready === 3);
  removeB();
  expect(paths.every((path) => path.startsWith("/events?subscriptions="))).toBe(true);
  await expect(
    readResult(
      await api.fetch(new Request("http://localhost" + eventPath([{ event: "unknown" }])), "ui"),
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});

test("event parsing bounds each frame, not a batch of coalesced frames", async () => {
  const frame = JSON.stringify({ type: "event", payload: "x".repeat(600_000) }) + "\n";
  let frames = 0;
  for await (const _ of readLines(new Response(frame.repeat(4)))) frames++;
  expect(frames).toBe(4);
  await expect(readLines(new Response("{")).next()).rejects.toBeInstanceOf(APIError);
});

test("typed lifecycle and routes infer the contract while legacy WebSocket generics remain valid", () => {
  const implementation = implementAPI(contract, {
    echo: (v) => v,
    optional: () => ({}),
    invalid: () => null,
  });
  defineBackend({
    api: implementation,
    start({ emit }) {
      emit("changed", { sessionId: "a", status: "idle" });
      // @ts-expect-error event name is inferred
      emit("missing", {});
      // @ts-expect-error payload is inferred
      emit("other", "wrong");
    },
    stop({ emit }) {
      emit("other", 1);
    },
    beforeUpdate({ emit }) {
      emit("other", 1);
      return { ready: true };
    },
    http: {
      routes: {
        "/thing/:id": (request, _server, { emit }) => {
          const id: string = request.params.id;
          emit("changed", { sessionId: id, status: "idle" });
          // @ts-expect-error route event name is inferred
          emit("missing", {});
          return new Response(id);
        },
      },
    },
  });
  defineBackend<{ session: string }, "/ws">({
    http: {
      routes: { "/ws": (_req, _server, _ctx) => new Response() },
      websocket: {
        message(socket) {
          const session: string = socket.data.session;
          void session;
        },
      },
    },
  });
  expect(() => defineBackend({ apiOptions: { eventBufferBytes: 10 } })).toThrow("1 MiB");
});

test("standard Zod schemas interoperate and conversion errors identify their contract location", () => {
  const schema = describeAPI(
    defineAPI({
      methods: {
        external: {
          description: "SDK",
          input: standardZ.object({ name: standardZ.string() }),
          output: standardZ.string(),
        },
      },
    }),
  );
  expect(schema.methods.external?.input.type).toBe("object");
  expect(() =>
    defineAPI({ methods: { bad: { description: "bad", input: z.date(), output: z.string() } } }),
  ).toThrow("methods.bad.input");
  expect(() =>
    defineAPI({ methods: {}, events: { bad: { description: "bad", payload: z.date() } } }),
  ).toThrow("events.bad.payload");
});
