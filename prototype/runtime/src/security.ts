import { randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "fia_session";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function secretEquals(actual: string | undefined, expected: string | undefined): boolean {
  if (actual === undefined || expected === undefined) return false;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

export function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function bearerToken(header: string | null): string | undefined {
  if (header === null || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return token.length > 0 ? token : undefined;
}

