import { expect, test } from "bun:test";
import { BrowserSessions, applicationRoute } from "../src/browser-sessions.ts";

test("browser tickets and socket grants bind route, lifetime, origin and instance", () => {
  const origin = "http://127.0.0.1:43210";
  const sessions = new BrowserSessions("one");
  const other = new BrowserSessions("two");
  const ticket = new URL(sessions.issue(origin, "/settings?tab=appearance#theme")).hash.slice(1);
  expect(ticket).toMatch(/^[a-f0-9]{64}$/);
  expect(() => other.exchange(ticket, origin)).toThrow();
  expect(() => sessions.exchange(ticket, "http://127.0.0.1:43211")).toThrow();
  const entry = sessions.exchange(ticket, origin);
  expect(entry.route).toBe("/settings?tab=appearance&fiaBrowser=1&fiaGeneration=one#theme");
  expect(entry.token).not.toBe(sessions.nativeToken);
  expect(other.get(entry.token)).toBeUndefined();
  expect(() => sessions.exchange(ticket, origin)).toThrow();
  const session = sessions.get(entry.token)!;
  const socket = new URL(sessions.socketTicket(session, "/api/feed?channel=one"));
  expect(sessions.consumeSocket(new URL(socket), "http://127.0.0.1:43211")).toBeUndefined();
  expect(sessions.consumeSocket(new URL(socket), origin)).toBeUndefined();
  const expiring = new URL(sessions.socketTicket(session, "/api/feed"));
  const expires = new URL(sessions.issue(origin, "/")).hash.slice(1);
  const now = Date.now;
  try {
    Date.now = () => now() + 61_000;
    expect(sessions.consumeSocket(expiring, origin)).toBeUndefined();
    expect(() => sessions.exchange(expires, origin)).toThrow();
  } finally {
    Date.now = now;
  }
  const revoked = new URL(sessions.socketTicket(session, "/api/feed"));
  sessions.revoke();
  expect(session.controller.signal.aborted).toBe(true);
  expect(sessions.get(entry.token)).toBeUndefined();
  expect(sessions.consumeSocket(revoked, origin)).toBeUndefined();
});

test("browser routes cannot escape the application or target protected framework endpoints", () => {
  for (const path of [
    "https://example.test/",
    "//example.test/",
    "/\\evil",
    "/%2fexample.test",
    "/a/../api",
    "/_fia/native",
    "/api/private",
    "/%00",
  ])
    expect(applicationRoute(path)).toBe(false);
  expect(applicationRoute("/settings?tab=general#section")).toBe(true);
});
