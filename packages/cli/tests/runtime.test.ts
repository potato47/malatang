import { describe, expect, test } from "bun:test";
import { BackendApplicationError, defineApp, isFIAApplication } from "../src/runtime.ts";

describe("public FIA runtime API", () => {
  test("brands declarative applications without exposing the marker", () => {
    const application = defineApp({
      backend: { methods: { value: () => 1 } },
      routes: { "/api/value": () => Response.json({ value: 1 }) },
    });
    expect(isFIAApplication(application)).toBe(true);
    expect(Object.keys(application)).toEqual(["backend", "routes"]);
  });

  test("defines structured backend application errors", () => {
    const error = new BackendApplicationError("NOT_FOUND", "Missing", { id: 7 });
    expect(error).toMatchObject({ code: "NOT_FOUND", message: "Missing", details: { id: 7 } });
  });

  test("rejects non-object application definitions", () => {
    expect(() => defineApp(null as never)).toThrow("application object");
    expect(isFIAApplication({ routes: {} })).toBe(false);
  });
});
