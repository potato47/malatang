import { randomBytes, timingSafeEqual } from "node:crypto";
import { APIError } from "./api-client.ts";

export const secretEqual = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const random = () => randomBytes(32).toString("hex");
export function applicationRoute(route: string): boolean {
  try {
    const decoded = decodeURIComponent(route);
    const url = new URL(route, "http://127.0.0.1");
    return (
      route.startsWith("/") &&
      !decoded.startsWith("//") &&
      !/[\\\p{Cc}]/u.test(decoded) &&
      !decoded.split(/[/?#]/).some((p) => p === "." || p === "..") &&
      url.origin === "http://127.0.0.1" &&
      !url.pathname.startsWith("/_fia") &&
      url.pathname !== "/api" &&
      !url.pathname.startsWith("/api/")
    );
  } catch {
    return false;
  }
}
export interface BrowserSession {
  token: string;
  origin: string;
  controller: AbortController;
  sockets: Set<Bun.ServerWebSocket<unknown>>;
}
type Ticket = { expires: number; route: string; origin: string };
export class BrowserSessions {
  readonly nativeToken = random();
  readonly cookieName = "fia_native_" + random().slice(0, 12);
  private tickets = new Map<string, Ticket>();
  private sessions = new Map<string, BrowserSession>();
  private sockets = new Map<string, { expires: number; path: string; session: BrowserSession }>();
  constructor(readonly generation: string) {}
  issue(origin: string, route: string): string {
    if (!applicationRoute(route))
      throw new APIError("invalid_argument", "Invalid application route");
    this.prune();
    if (this.tickets.size >= 64 || this.sessions.size >= 64)
      throw new APIError("resource_limit", "Disconnect browser sessions before opening more pages");
    const ticket = random();
    this.tickets.set(ticket, { expires: Date.now() + 60_000, route, origin });
    return origin + "/_fia/browser/open#" + ticket;
  }
  exchange(ticket: string, origin: string) {
    const entry = this.tickets.get(ticket);
    if (!entry || entry.expires <= Date.now() || entry.origin !== origin)
      throw new APIError("forbidden", "Invalid or expired browser ticket");
    this.tickets.delete(ticket);
    if (this.sessions.size >= 64) throw new APIError("resource_limit", "Too many browser sessions");
    const token = random();
    this.sessions.set(token, {
      token,
      origin,
      controller: new AbortController(),
      sockets: new Set(),
    });
    const route = new URL(entry.route, origin);
    route.searchParams.set("fiaBrowser", "1");
    route.searchParams.set("fiaGeneration", this.generation);
    route.searchParams.delete("fiaWindow");
    return {
      token,
      generation: this.generation,
      route: route.pathname + route.search + route.hash,
    };
  }
  get(token: string) {
    return this.sessions.get(token);
  }
  socketTicket(session: BrowserSession, path: string): string {
    const url = new URL(path, session.origin);
    if (
      url.origin !== session.origin ||
      url.hash ||
      url.searchParams.has("fiaSocketTicket") ||
      (url.pathname !== "/_fia/native" && !url.pathname.startsWith("/api/"))
    )
      throw new APIError("invalid_argument", "WebSocket path must be an application endpoint");
    this.prune();
    if (this.sockets.size >= 256)
      throw new APIError("resource_limit", "Too many pending WebSockets");
    const ticket = random();
    this.sockets.set(ticket, {
      expires: Date.now() + 10_000,
      path: url.pathname + url.search,
      session,
    });
    url.searchParams.set("fiaSocketTicket", ticket);
    url.protocol = "ws:";
    return url.href;
  }
  consumeSocket(url: URL, origin: string | null): BrowserSession | undefined {
    const ticket = url.searchParams.get("fiaSocketTicket") ?? "";
    const entry = this.sockets.get(ticket);
    this.sockets.delete(ticket);
    url.searchParams.delete("fiaSocketTicket");
    if (
      !entry ||
      entry.expires <= Date.now() ||
      entry.session.origin !== origin ||
      entry.path !== url.pathname + url.search ||
      entry.session.controller.signal.aborted
    )
      return;
    return entry.session;
  }
  revoke() {
    this.tickets.clear();
    this.sockets.clear();
    for (const session of this.sessions.values()) {
      session.controller.abort();
      for (const socket of session.sockets) socket.close(4001, "Browser authorization ended");
    }
    this.sessions.clear();
  }
  private prune() {
    for (const [key, value] of this.tickets)
      if (value.expires <= Date.now()) this.tickets.delete(key);
    for (const [key, value] of this.sockets)
      if (value.expires <= Date.now()) this.sockets.delete(key);
  }
}

// Enumerated deliberately: new native methods are not implicitly browser permissions.
export const browserNativeMethods = new Set([
  "native.capabilities",
  "application.info",
  "application.show",
  "application.setAppearance",
  "clipboard.readText",
  "clipboard.writeText",
  "dialogs.openFiles",
  "dialogs.saveFile",
  "notifications.requestAuthorization",
  "notifications.deliver",
  "screens.list",
  "system.openURL",
  "system.reveal",
  "resources.dispose",
  "updates.state",
  "updates.check",
  "updates.download",
  "updates.apply",
  "windows.create",
  "windows.update",
  "windows.setTitlebar",
  "windows.open",
  "windows.hide",
  "windows.focus",
  "windows.close",
  "windows.state",
  "windows.minimize",
  "windows.maximize",
  "windows.restore",
  "windows.toggleFullscreen",
]);
