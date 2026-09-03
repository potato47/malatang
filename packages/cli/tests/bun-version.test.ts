import { describe, expect, test } from "bun:test";
import { isBunVersionSupported, MINIMUM_BUN_VERSION } from "../src/bun-version.ts";

describe("Bun version support", () => {
  test("accepts the minimum and newer versions", () => {
    expect(MINIMUM_BUN_VERSION).toBe("1.4.0");
    expect(isBunVersionSupported("1.4.0")).toBe(true);
    expect(isBunVersionSupported("1.4.1")).toBe(true);
    expect(isBunVersionSupported("1.5.0")).toBe(true);
    expect(isBunVersionSupported("2.0.0")).toBe(true);
  });

  test("rejects older, prerelease, and invalid versions", () => {
    expect(isBunVersionSupported("1.3.14")).toBe(false);
    expect(isBunVersionSupported("1.3.99")).toBe(false);
    expect(isBunVersionSupported("1.4.0-canary.1")).toBe(false);
    expect(isBunVersionSupported("invalid")).toBe(false);
  });
});
