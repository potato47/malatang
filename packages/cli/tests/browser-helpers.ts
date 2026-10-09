import { createHmac } from "node:crypto";
import type { InitializeFrame } from "../src/backend.ts";

export async function nativeCookie(origin: string, init: InitializeFrame): Promise<string> {
  const nonce = crypto.randomUUID();
  const query = new URLSearchParams({
    window: "main",
    route: "/",
    nonce,
    proof: createHmac("sha256", init.sessionSecret)
      .update(["main", "/", nonce, init.generation].join("\n"))
      .digest("hex"),
  });
  const response = await fetch(origin + "/_fia/bootstrap?" + query, { redirect: "manual" });
  if (response.status !== 302) throw new Error("Native bootstrap failed");
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
export async function exchangeBrowser(origin: string, issued: string) {
  const url = new URL(issued);
  return fetch(origin + "/_fia/browser/exchange", {
    method: "POST",
    headers: {
      origin: url.origin,
      "content-type": "application/json",
      "x-fia-browser-bootstrap": "1",
    },
    body: JSON.stringify({ ticket: url.hash.slice(1) }),
  });
}
