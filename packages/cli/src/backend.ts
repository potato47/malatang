export const FIA_BACKEND_BRIDGE_VERSION = 1 as const;

export type FIABackendErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_RESTARTED"
  | "BACKEND_TIMEOUT"
  | "INVALID_REQUEST"
  | "PROTOCOL_ERROR"
  | "APPLICATION_ERROR";

export class FIABackendError extends Error {
  readonly code: FIABackendErrorCode;
  readonly applicationCode?: string;
  readonly details?: unknown;

  constructor(
    code: FIABackendErrorCode,
    message: string,
    options: { applicationCode?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "FIABackendError";
    this.code = code;
    this.applicationCode = options.applicationCode;
    this.details = options.details;
  }
}

interface BackendMessageHandler {
  postMessage(message: unknown): Promise<unknown>;
}

interface BackendBridgeGlobal {
  webkit?: {
    messageHandlers?: {
      fiaBackend?: BackendMessageHandler;
    };
  };
}

interface BackendErrorPayload {
  code: FIABackendErrorCode;
  message: string;
  applicationCode?: string;
  details?: unknown;
}

type BackendResponse =
  | { ok: true; value?: unknown }
  | { ok: false; error: BackendErrorPayload };

const EVENT_NAME = "fia:backend-event";
const ERROR_CODES = new Set<FIABackendErrorCode>([
  "BACKEND_UNAVAILABLE",
  "BACKEND_RESTARTED",
  "BACKEND_TIMEOUT",
  "INVALID_REQUEST",
  "PROTOCOL_ERROR",
  "APPLICATION_ERROR",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageHandler(): BackendMessageHandler | undefined {
  return (globalThis as BackendBridgeGlobal).webkit?.messageHandlers?.fiaBackend;
}

function parseResponse(value: unknown): BackendResponse {
  if (!isObject(value) || typeof value.ok !== "boolean") {
    throw new FIABackendError("PROTOCOL_ERROR", "The Swift backend bridge returned an invalid response");
  }
  if (value.ok === true) return { ok: true, value: value.value };
  if (!isObject(value.error)
    || typeof value.error.code !== "string"
    || !ERROR_CODES.has(value.error.code as FIABackendErrorCode)
    || typeof value.error.message !== "string"
    || (value.error.applicationCode !== undefined && typeof value.error.applicationCode !== "string")) {
    throw new FIABackendError("PROTOCOL_ERROR", "The Swift backend bridge returned an invalid error");
  }
  return {
    ok: false,
    error: {
      code: value.error.code as FIABackendErrorCode,
      message: value.error.message,
      ...(value.error.applicationCode === undefined ? {} : { applicationCode: value.error.applicationCode }),
      ...(value.error.details === undefined ? {} : { details: value.error.details }),
    },
  };
}

export const backend = {
  isAvailable(): boolean {
    return messageHandler() !== undefined;
  },

  async invoke<Input = undefined, Output = unknown>(method: string, input?: Input): Promise<Output> {
    if (typeof method !== "string" || method.length === 0) {
      throw new FIABackendError("INVALID_REQUEST", "The Swift backend method must not be empty");
    }
    const handler = messageHandler();
    if (handler === undefined) {
      throw new FIABackendError("BACKEND_UNAVAILABLE", "The FIA Swift backend is unavailable in this environment");
    }
    let raw: unknown;
    try {
      raw = await handler.postMessage({
        version: FIA_BACKEND_BRIDGE_VERSION,
        method,
        input: input === undefined ? null : input,
      });
    } catch (error) {
      if (error instanceof FIABackendError) throw error;
      throw new FIABackendError("BACKEND_UNAVAILABLE", "The Swift backend request failed", { cause: error });
    }
    const response = parseResponse(raw);
    if (!response.ok) {
      throw new FIABackendError(response.error.code, response.error.message, {
        applicationCode: response.error.applicationCode,
        details: response.error.details,
      });
    }
    return response.value as Output;
  },

  onEvent<Payload = unknown>(name: string, listener: (payload: Payload) => void): () => void {
    const receive = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isObject(detail) || detail.name !== name || !("payload" in detail)) return;
      listener(detail.payload as Payload);
    };
    globalThis.addEventListener(EVENT_NAME, receive);
    return () => globalThis.removeEventListener(EVENT_NAME, receive);
  },
} as const;
