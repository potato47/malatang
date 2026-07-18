import { describe, expect, test } from "bun:test";
import { randomToken } from "../src/security.ts";
import {
  MAX_CONTROL_LINE_BYTES,
  ProtocolError,
  decodeLines,
  parseInitializeLine,
  parseShutdownLine,
  serializeReady,
} from "../src/protocol.ts";

function initialize(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocol: 1,
    type: "initialize",
    bootstrapToken: randomToken(),
    controlToken: randomToken(),
    parentPid: 42,
    dataDirectory: "/tmp/fia",
    ...overrides,
  });
}

describe("runtime control protocol", () => {
  test("parses a strict initialize message", () => {
    const parsed = parseInitializeLine(initialize());
    expect(parsed.type).toBe("initialize");
    expect(parsed.dataDirectory).toBe("/tmp/fia");
  });

  test("rejects unknown fields, relative paths, reused tokens, and oversized lines", () => {
    expect(() => parseInitializeLine(initialize({ extra: true }))).toThrow(ProtocolError);
    expect(() => parseInitializeLine(initialize({ dataDirectory: "relative" }))).toThrow(ProtocolError);
    const token = randomToken();
    expect(() => parseInitializeLine(initialize({ bootstrapToken: token, controlToken: token }))).toThrow(
      ProtocolError,
    );
    expect(() => parseInitializeLine("x".repeat(MAX_CONTROL_LINE_BYTES))).toThrow(ProtocolError);
  });

  test("only accepts the phase zero shutdown message", () => {
    expect(parseShutdownLine('{"protocol":1,"type":"shutdown","reason":"applicationQuit"}').reason)
      .toBe("applicationQuit");
    expect(() => parseShutdownLine('{"protocol":2,"type":"shutdown","reason":"applicationQuit"}'))
      .toThrow(ProtocolError);
  });

  test("serializes validated ready messages", () => {
    expect(serializeReady(49152, 123)).toBe('{"protocol":1,"type":"ready","port":49152,"pid":123}\n');
    expect(() => serializeReady(0, 123)).toThrow(ProtocolError);
    expect(() => serializeReady(80, 1)).toThrow(ProtocolError);
  });

  test("decodes fragmented NDJSON and rejects partial EOF", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("one\nt"));
        controller.enqueue(encoder.encode("wo\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of decodeLines(stream)) lines.push(line);
    expect(lines).toEqual(["one", "two"]);

    const partial = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("partial"));
        controller.close();
      },
    });
    await expect(async () => {
      for await (const _line of decodeLines(partial)) {
        // no-op
      }
    }).toThrow(ProtocolError);
  });
});

