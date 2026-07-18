import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { type InitializeMessage } from "../src/protocol.ts";
import { startRuntimeServer, type RuntimeServer } from "../src/runtime-server.ts";
import { randomToken } from "../src/security.ts";

const running = new Set<RuntimeServer>();

afterEach(async () => {
  await Promise.all([...running].map((server) => server.stop()));
  running.clear();
});

function start(): { server: RuntimeServer; initialize: InitializeMessage } {
  const initialize: InitializeMessage = {
    protocol: 1,
    type: "initialize",
    bootstrapToken: randomToken(),
    controlToken: randomToken(),
    parentPid: process.ppid,
    dataDirectory: process.cwd(),
  };
  const server = startRuntimeServer({
    initialize,
    checkParent: false,
    uiTemplate: '<!doctype html><style nonce="__FIA_CSP_NONCE__"></style><script nonce="__FIA_CSP_NONCE__"></script>',
  });
  running.add(server);
  return { server, initialize };
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (value === null) throw new Error("missing session cookie");
  return value.split(";", 1)[0]!;
}

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const prefix = payload.length < 126
    ? Buffer.from([0x81, 0x80 | payload.length])
    : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([prefix, mask, masked]);
}

function parseTextFrame(buffer: Buffer): { text: string; consumed: number } | undefined {
  if (buffer.length < 2) return undefined;
  if ((buffer[0]! & 0x0f) !== 0x01) throw new Error("Expected a text WebSocket frame");
  let payloadLength = buffer[1]! & 0x7f;
  let offset = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) return undefined;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    throw new Error("Unexpected 64-bit WebSocket frame in echo test");
  }
  if (buffer.length < offset + payloadLength) return undefined;
  return {
    text: buffer.subarray(offset, offset + payloadLength).toString("utf8"),
    consumed: offset + payloadLength,
  };
}

async function rawWebSocketEcho(
  server: RuntimeServer,
  cookie: string,
  requestPayload: string,
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: server.port });
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("WebSocket echo timed out"));
    }, 2_000);

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write([
        "GET /__fia/ws HTTP/1.1",
        `Host: 127.0.0.1:${server.port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: fia.v1",
        `Origin: ${server.origin}`,
        `Cookie: ${cookie}`,
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const headers = buffer.subarray(0, headerEnd).toString("utf8");
        if (!headers.startsWith("HTTP/1.1 101")) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`WebSocket upgrade failed: ${headers}`));
          return;
        }
        if (!headers.toLowerCase().includes("sec-websocket-protocol: fia.v1")) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error("WebSocket server did not negotiate fia.v1"));
          return;
        }
        buffer = buffer.subarray(headerEnd + 4);
        upgraded = true;
        socket.write(maskedTextFrame(requestPayload));
      }

      const frame = parseTextFrame(buffer);
      if (frame === undefined) return;
      clearTimeout(timeout);
      const parsed = JSON.parse(frame.text) as Record<string, unknown>;
      socket.destroy();
      setTimeout(() => resolve(parsed), 50);
    });
  });
}

describe("runtime HTTP security", () => {
  test("bootstraps once and protects UI/API routes", async () => {
    const { server, initialize } = start();
    expect((await fetch(`${server.origin}/api/hello`)).status).toBe(401);

    const bootstrap = await fetch(`${server.origin}/__fia/bootstrap/${initialize.bootstrapToken}`, {
      redirect: "manual",
    });
    expect(bootstrap.status).toBe(303);
    expect(bootstrap.headers.get("location")).toBe("/");
    const cookie = sessionCookie(bootstrap);

    expect((await fetch(`${server.origin}/__fia/bootstrap/${initialize.bootstrapToken}`, {
      redirect: "manual",
    })).status).toBe(404);

    const hello = await fetch(`${server.origin}/api/hello`, { headers: { Cookie: cookie } });
    expect(hello.status).toBe(200);
    expect(await hello.json()).toEqual({ protocol: 1, message: "Hello from FIA" });

    const page = await fetch(server.origin, { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-");
    expect(await page.text()).not.toContain("__FIA_CSP_NONCE__");
  });

  test("isolates the control token and validates Host and Origin", async () => {
    const { server, initialize } = start();
    expect((await fetch(`${server.origin}/__fia/health`)).status).toBe(401);
    expect((await fetch(`${server.origin}/__fia/health`, {
      headers: { Authorization: `Bearer ${initialize.bootstrapToken}` },
    })).status).toBe(401);

    const health = await fetch(`${server.origin}/__fia/health`, {
      headers: { Authorization: `Bearer ${initialize.controlToken}` },
    });
    expect(health.status).toBe(200);

    const wrongHost = await fetch(`${server.origin}/__fia/health`, {
      headers: {
        Authorization: `Bearer ${initialize.controlToken}`,
        Host: `localhost:${server.port}`,
      },
    });
    expect(wrongHost.status).toBe(421);

    const wrongOrigin = await fetch(`${server.origin}/__fia/health`, {
      headers: {
        Authorization: `Bearer ${initialize.controlToken}`,
        Origin: "https://example.com",
      },
    });
    expect(wrongOrigin.status).toBe(403);
  });

  test("authenticates fia.v1 WebSockets and echoes correlated messages", async () => {
    const { server, initialize } = start();
    const bootstrap = await fetch(`${server.origin}/__fia/bootstrap/${initialize.bootstrapToken}`, {
      redirect: "manual",
    });
    const cookie = sessionCookie(bootstrap);
    const response = await rawWebSocketEcho(server, cookie, JSON.stringify({
      protocol: 1,
      type: "request",
      id: "ws-1",
      method: "echo",
      params: { message: "hello over websocket" },
    }));

    expect(response).toEqual({
      protocol: 1,
      type: "response",
      id: "ws-1",
      result: { echo: "hello over websocket" },
    });
  });
});
