import { isAbsolute } from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_CONTROL_LINE_BYTES = 16 * 1024;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface InitializeMessage {
  protocol: 1;
  type: "initialize";
  bootstrapToken: string;
  controlToken: string;
  parentPid: number;
  dataDirectory: string;
}

export interface ShutdownMessage {
  protocol: 1;
  type: "shutdown";
  reason: "applicationQuit";
}

export interface ReadyMessage {
  protocol: 1;
  type: "ready";
  port: number;
  pid: number;
}

export type HostMessage = InitializeMessage | ShutdownMessage;

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProtocolError(`${label} contains missing or unknown fields`);
  }
}

function parseJSONLine(line: string): unknown {
  if (Buffer.byteLength(line, "utf8") + 1 > MAX_CONTROL_LINE_BYTES) {
    throw new ProtocolError("control message exceeds 16 KiB");
  }

  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new ProtocolError("control message is not valid JSON");
  }
}

export function parseInitializeLine(line: string): InitializeMessage {
  const value = parseJSONLine(line);
  assertPlainObject(value, "initialize message");
  assertExactKeys(
    value,
    ["protocol", "type", "bootstrapToken", "controlToken", "parentPid", "dataDirectory"],
    "initialize message",
  );

  if (value.protocol !== PROTOCOL_VERSION || value.type !== "initialize") {
    throw new ProtocolError("unsupported initialize protocol or type");
  }
  if (typeof value.bootstrapToken !== "string" || !TOKEN_PATTERN.test(value.bootstrapToken)) {
    throw new ProtocolError("bootstrapToken must be a 32-byte base64url token");
  }
  if (typeof value.controlToken !== "string" || !TOKEN_PATTERN.test(value.controlToken)) {
    throw new ProtocolError("controlToken must be a 32-byte base64url token");
  }
  if (value.bootstrapToken === value.controlToken) {
    throw new ProtocolError("bootstrapToken and controlToken must be independent");
  }
  if (!Number.isSafeInteger(value.parentPid) || (value.parentPid as number) <= 1) {
    throw new ProtocolError("parentPid must be a valid process identifier");
  }
  if (typeof value.dataDirectory !== "string" || !isAbsolute(value.dataDirectory)) {
    throw new ProtocolError("dataDirectory must be an absolute path");
  }

  return value as unknown as InitializeMessage;
}

export function parseShutdownLine(line: string): ShutdownMessage {
  const value = parseJSONLine(line);
  assertPlainObject(value, "shutdown message");
  assertExactKeys(value, ["protocol", "type", "reason"], "shutdown message");
  if (
    value.protocol !== PROTOCOL_VERSION ||
    value.type !== "shutdown" ||
    value.reason !== "applicationQuit"
  ) {
    throw new ProtocolError("invalid shutdown message");
  }
  return value as unknown as ShutdownMessage;
}

export function serializeReady(port: number, pid: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProtocolError("ready port is out of range");
  }
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new ProtocolError("ready pid is invalid");
  }
  const message: ReadyMessage = { protocol: PROTOCOL_VERSION, type: "ready", port, pid };
  return `${JSON.stringify(message)}\n`;
}

export async function* decodeLines(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = MAX_CONTROL_LINE_BYTES,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        buffer += decoder.decode(value, { stream: true });
      } catch {
        throw new ProtocolError("control stream is not valid UTF-8");
      }
      if (Buffer.byteLength(buffer, "utf8") > maximumBytes && !buffer.includes("\n")) {
        throw new ProtocolError("control message exceeds 16 KiB");
      }

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (Buffer.byteLength(line, "utf8") + 1 > maximumBytes) {
          throw new ProtocolError("control message exceeds 16 KiB");
        }
        yield line;
        newline = buffer.indexOf("\n");
      }
    }

    try {
      buffer += decoder.decode();
    } catch {
      throw new ProtocolError("control stream is not valid UTF-8");
    }
    if (buffer.length > 0) {
      throw new ProtocolError("control stream ended with a partial message");
    }
  } finally {
    reader.releaseLock();
  }
}

