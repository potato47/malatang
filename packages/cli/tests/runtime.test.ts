import { describe, expect, test } from "bun:test";
import { defineApp, isFIAApplication } from "../src/runtime.ts";

describe("public FIA runtime API", () => {
  test("brands declarative applications without exposing the marker", () => {
    const application = defineApp({
      routes: { "/api/value": () => Response.json({ value: 1 }) },
    });
    expect(isFIAApplication(application)).toBe(true);
    expect(Object.keys(application)).toEqual(["routes"]);
  });

  test("rejects non-object application definitions", () => {
    expect(() => defineApp(null as never)).toThrow("application object");
    expect(isFIAApplication({ routes: {} })).toBe(false);
  });
});
