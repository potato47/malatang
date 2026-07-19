import { timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "fia_session";

export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function secretEquals(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function bearerToken(header: string | null): string | undefined {
  if (header === null || !header.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}
