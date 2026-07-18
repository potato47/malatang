import { type Server, type ServerWebSocket } from "bun";
import { handleEchoMessage } from "./echo.ts";
import { PROTOCOL_VERSION, type InitializeMessage } from "./protocol.ts";
import {
  SESSION_COOKIE_NAME,
  bearerToken,
  cookieValue,
  randomToken,
  secretEquals,
} from "./security.ts";

interface SocketData {
  session: string;
}

export interface RuntimeServer {
  readonly port: number;
  readonly origin: string;
  stop(): Promise<void>;
}

export interface RuntimeServerOptions {
  initialize: InitializeMessage;
  uiTemplate: string;
  checkParent?: boolean;
  logger?: (message: string) => void;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UI_NONCE_PLACEHOLDER = "__FIA_CSP_NONCE__";

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function generic(status: number): Response {
  return new Response(status === 404 ? "Not Found" : "Request Rejected", {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function includesProtocol(header: string | null, protocol: string): boolean {
  return header?.split(",").some((item) => item.trim() === protocol) ?? false;
}

export function startRuntimeServer(options: RuntimeServerOptions): RuntimeServer {
  let bootstrapToken: string | undefined = options.initialize.bootstrapToken;
  const controlToken = options.initialize.controlToken;
  let sessionToken: string | undefined;
  let expectedHost = "";
  let origin = "";
  let stopped = false;
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const logger = options.logger ?? ((message: string) => console.error(message));

  const server: Server<SocketData> = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 64 * 1024,
    idleTimeout: 10,
    development: false,
    async fetch(request, bunServer) {
      try {
        if (request.headers.get("host") !== expectedHost) return generic(421);
        const url = new URL(request.url);
        const requestOrigin = request.headers.get("origin");
        if (requestOrigin !== null && requestOrigin !== origin) return generic(403);
        if (!SAFE_METHODS.has(request.method) && requestOrigin !== origin) return generic(403);

        if (request.method === "GET" && url.pathname.startsWith("/__fia/bootstrap/")) {
          const supplied = url.pathname.slice("/__fia/bootstrap/".length);
          if (!secretEquals(supplied, bootstrapToken)) return generic(404);
          bootstrapToken = undefined;
          sessionToken = randomToken();
          return new Response(null, {
            status: 303,
            headers: {
              "Cache-Control": "no-store",
              Location: "/",
              "Set-Cookie": `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        }

        if (request.method === "GET" && url.pathname === "/__fia/health") {
          if (!secretEquals(bearerToken(request.headers.get("authorization")), controlToken)) {
            return generic(401);
          }
          return json({ protocol: PROTOCOL_VERSION, status: "ok", pid: process.pid });
        }

        const suppliedSession = cookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
        const authenticated = secretEquals(suppliedSession, sessionToken);

        if (request.method === "GET" && url.pathname === "/__fia/ws") {
          if (!authenticated || requestOrigin !== origin) return generic(401);
          if (!includesProtocol(request.headers.get("sec-websocket-protocol"), "fia.v1")) {
            return generic(426);
          }
          const upgraded = bunServer.upgrade(request, {
            data: { session: suppliedSession! },
            headers: { "Sec-WebSocket-Protocol": "fia.v1" },
          });
          return upgraded ? undefined : generic(400);
        }

        if (!authenticated) return generic(401);

        if (request.method === "GET" && url.pathname === "/") {
          const nonce = randomToken();
          const html = options.uiTemplate.replaceAll(UI_NONCE_PLACEHOLDER, nonce);
          return new Response(html, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Security-Policy": [
                "default-src 'none'",
                "base-uri 'none'",
                "object-src 'none'",
                "frame-ancestors 'none'",
                `script-src 'nonce-${nonce}'`,
                `style-src 'nonce-${nonce}'`,
                "img-src 'self' data:",
                "font-src 'self' data:",
                "connect-src 'self'",
              ].join("; "),
              "Content-Type": "text/html; charset=utf-8",
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Frame-Options": "DENY",
            },
          });
        }

        if (request.method === "GET" && url.pathname === "/api/hello") {
          return json({ protocol: PROTOCOL_VERSION, message: "Hello from FIA" });
        }

        return generic(404);
      } catch (error) {
        logger(`request failed: ${error instanceof Error ? error.message : "unknown error"}`);
        return generic(500);
      }
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: 64 * 1024,
      idleTimeout: 30,
      backpressureLimit: 64 * 1024,
      closeOnBackpressureLimit: true,
      sendPings: true,
      perMessageDeflate: false,
      open(socket) {
        sockets.add(socket);
      },
      message(socket, message) {
        if (typeof message !== "string") {
          socket.close(1003, "text messages only");
          return;
        }
        const result = handleEchoMessage(message);
        if (result === undefined) {
          socket.close(1007, "invalid message");
          return;
        }
        socket.send(JSON.stringify(result));
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });

  const port = server.port;
  if (port === undefined) throw new Error("Bun did not assign a TCP port");
  expectedHost = `127.0.0.1:${port}`;
  origin = `http://${expectedHost}`;

  const parentTimer = options.checkParent === false
    ? undefined
    : setInterval(() => {
        if (process.ppid !== options.initialize.parentPid) {
          logger("parent process changed; stopping runtime");
          void stop();
        }
      }, 1_000);
  parentTimer?.unref();

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (parentTimer !== undefined) clearInterval(parentTimer);
    for (const socket of sockets) socket.close(1001, "runtime shutting down");
    sockets.clear();
    await server.stop(true);
  }

  return { port, origin, stop };
}

