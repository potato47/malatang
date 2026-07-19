import { isAbsolute } from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_CONTROL_LINE_BYTES = 16 * 1024;
export const MAXIMUM_CONTROL_LINE_BYTES = MAX_CONTROL_LINE_BYTES;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface InitializeMessage {
  protocol: typeof PROTOCOL_VERSION;
  type: "initialize";
  bootstrapToken: string;
  controlToken: string;
  parentPid: number;
  dataDirectory: string;
}

export interface ShutdownMessage {
  protocol: typeof PROTOCOL_VERSION;
  type: "shutdown";
  reason: "applicationQuit";
}

export interface ReadyMessage {
  protocol: typeof PROTOCOL_VERSION;
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

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError("control message must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort().join(",");
  const wanted = [...expected].sort().join(",");
  if (actual !== wanted) throw new ProtocolError("control message contains unknown or missing fields");
}

function parse(line: string): Record<string, unknown> {
  if (Buffer.byteLength(line) + 1 > MAX_CONTROL_LINE_BYTES) {
    throw new ProtocolError("control message exceeds 16 KiB");
  }
  try {
    return object(JSON.parse(line));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("control message is not valid JSON");
  }
}

export function parseInitializeLine(line: string): InitializeMessage {
  const value = parse(line);
  exactKeys(value, ["protocol", "type", "bootstrapToken", "controlToken", "parentPid", "dataDirectory"]);
  if (value.protocol !== PROTOCOL_VERSION || value.type !== "initialize") {
    throw new ProtocolError("expected FIA initialize protocol 1");
  }
  if (typeof value.bootstrapToken !== "string" || !TOKEN_PATTERN.test(value.bootstrapToken)) {
    throw new ProtocolError("bootstrap token is invalid");
  }
  if (typeof value.controlToken !== "string" || !TOKEN_PATTERN.test(value.controlToken)) {
    throw new ProtocolError("control token is invalid");
  }
  if (value.bootstrapToken === value.controlToken) throw new ProtocolError("control tokens must be independent");
  if (!Number.isSafeInteger(value.parentPid) || (value.parentPid as number) <= 1) {
    throw new ProtocolError("parent PID is invalid");
  }
  if (typeof value.dataDirectory !== "string" || !isAbsolute(value.dataDirectory)) {
    throw new ProtocolError("data directory must be absolute");
  }
  return value as unknown as InitializeMessage;
}

export function parseShutdownLine(line: string): ShutdownMessage {
  const value = parse(line);
  exactKeys(value, ["protocol", "type", "reason"]);
  if (value.protocol !== PROTOCOL_VERSION || value.type !== "shutdown" || value.reason !== "applicationQuit") {
    throw new ProtocolError("expected FIA shutdown protocol 1");
  }
  return value as unknown as ShutdownMessage;
}

export function serializeReady(port: number, pid: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new ProtocolError("ready port is invalid");
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new ProtocolError("ready PID is invalid");
  return `${JSON.stringify({ protocol: PROTOCOL_VERSION, type: "ready", port, pid })}\n`;
}

export async function* decodeLines(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = MAX_CONTROL_LINE_BYTES,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximumBytes && !result.value.includes(0x0A)) {
        throw new ProtocolError("control message exceeds 16 KiB");
      }
      buffer += decoder.decode(result.value, { stream: true });
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        bytes = Buffer.byteLength(buffer);
        if (Buffer.byteLength(line) + 1 > maximumBytes) {
          throw new ProtocolError("control message exceeds 16 KiB");
        }
        yield line;
      }
    }
    buffer += decoder.decode();
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("control stream is not valid UTF-8");
  } finally {
    reader.releaseLock();
  }
  if (buffer.length > 0) throw new ProtocolError("control stream ended with a partial line");
}
