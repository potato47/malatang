import { PROTOCOL_VERSION } from "./protocol.ts";

export interface EchoRequest {
  protocol: 1;
  type: "request";
  id: string;
  method: "echo";
  params: { message: string };
}

export type EchoResult =
  | { protocol: 1; type: "response"; id: string; result: { echo: string } }
  | { protocol: 1; type: "error"; id: string; error: { code: string; message: string } };

function error(id: string, code: string, message: string): EchoResult {
  return { protocol: PROTOCOL_VERSION, type: "error", id, error: { code, message } };
}

export function handleEchoMessage(input: string): EchoResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  const id = typeof message.id === "string" ? message.id : undefined;
  if (id === undefined || id.length < 1 || id.length > 128) return undefined;
  if (message.protocol !== PROTOCOL_VERSION || message.type !== "request") {
    return error(id, "invalid_request", "Unsupported protocol or message type");
  }
  if (message.method !== "echo") {
    return error(id, "method_not_found", "Unknown method");
  }
  if (typeof message.params !== "object" || message.params === null || Array.isArray(message.params)) {
    return error(id, "invalid_params", "params must be an object");
  }
  const params = message.params as Record<string, unknown>;
  if (typeof params.message !== "string" || params.message.length > 32_768) {
    return error(id, "invalid_params", "message must be a string up to 32768 characters");
  }
  return {
    protocol: PROTOCOL_VERSION,
    type: "response",
    id,
    result: { echo: params.message },
  };
}

