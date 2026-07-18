import { describe, expect, test } from "bun:test";
import { handleEchoMessage } from "../src/echo.ts";

describe("echo protocol", () => {
  test("returns a correlated response", () => {
    expect(handleEchoMessage(JSON.stringify({
      protocol: 1,
      type: "request",
      id: "abc",
      method: "echo",
      params: { message: "hello" },
    }))).toEqual({
      protocol: 1,
      type: "response",
      id: "abc",
      result: { echo: "hello" },
    });
  });

  test("returns structured errors when an id is available", () => {
    const result = handleEchoMessage(JSON.stringify({
      protocol: 1,
      type: "request",
      id: "abc",
      method: "missing",
      params: {},
    }));
    expect(result?.type).toBe("error");
  });

  test("rejects uncorrelatable input", () => {
    expect(handleEchoMessage("not json")).toBeUndefined();
    expect(handleEchoMessage("{}")) .toBeUndefined();
  });
});

