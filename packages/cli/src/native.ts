export const FIA_NATIVE_BRIDGE_VERSION = 1 as const;

export type FIANativeErrorCode =
  | "BRIDGE_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "UNKNOWN_COMMAND"
  | "INVALID_ARGUMENT"
  | "UNSAFE_STATE"
  | "NATIVE_FAILURE";

export type FIANativeApplicationMode = "dock" | "statusBar" | "hybrid";

export interface FIANativeWindowState {
  readonly visible: boolean;
  readonly focused: boolean;
  readonly alwaysOnTop: boolean;
  readonly visibleOnAllSpaces: boolean;
  readonly visibleOverFullScreen: boolean;
}

export interface FIANativeState {
  readonly mode: FIANativeApplicationMode;
  readonly dockVisible: boolean;
  readonly statusBarVisible: boolean;
  readonly statusBarSymbol: string;
  readonly window: FIANativeWindowState;
}

export type FIANativeEvent =
  | { readonly type: "stateChanged"; readonly state: FIANativeState }
  | { readonly type: "statusBarClicked"; readonly button: "left" };

export class FIANativeError extends Error {
  readonly code: FIANativeErrorCode;

  constructor(code: FIANativeErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "FIANativeError";
    this.code = code;
  }
}

interface NativeMessageHandler {
  postMessage(message: unknown): Promise<unknown>;
}

interface BridgeGlobal {
  webkit?: {
    messageHandlers?: {
      fiaNative?: NativeMessageHandler;
    };
  };
}

interface NativeErrorPayload {
  code: FIANativeErrorCode;
  message: string;
}

type NativeResponse =
  | { ok: true; value?: unknown }
  | { ok: false; error: NativeErrorPayload };

const EVENT_NAME = "fia:native-event";
const ERROR_CODES = new Set<FIANativeErrorCode>([
  "BRIDGE_UNAVAILABLE",
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "UNKNOWN_COMMAND",
  "INVALID_ARGUMENT",
  "UNSAFE_STATE",
  "NATIVE_FAILURE",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageHandler(): NativeMessageHandler | undefined {
  return (globalThis as BridgeGlobal).webkit?.messageHandlers?.fiaNative;
}

function parseResponse(value: unknown): NativeResponse {
  if (!isObject(value) || typeof value.ok !== "boolean") {
    throw new FIANativeError("NATIVE_FAILURE", "The native bridge returned an invalid response");
  }
  if (value.ok === true) return { ok: true, value: value.value };
  if (!isObject(value.error)
    || typeof value.error.code !== "string"
    || !ERROR_CODES.has(value.error.code as FIANativeErrorCode)
    || typeof value.error.message !== "string") {
    throw new FIANativeError("NATIVE_FAILURE", "The native bridge returned an invalid error");
  }
  return {
    ok: false,
    error: { code: value.error.code as FIANativeErrorCode, message: value.error.message },
  };
}

async function invoke<Result>(command: string, params: Record<string, unknown> = {}): Promise<Result> {
  const handler = messageHandler();
  if (handler === undefined) {
    throw new FIANativeError("BRIDGE_UNAVAILABLE", "The FIA native bridge is unavailable in this environment");
  }
  let raw: unknown;
  try {
    raw = await handler.postMessage({ version: FIA_NATIVE_BRIDGE_VERSION, command, params });
  } catch (error) {
    if (error instanceof FIANativeError) throw error;
    throw new FIANativeError("NATIVE_FAILURE", "The native bridge request failed", { cause: error });
  }
  const response = parseResponse(raw);
  if (!response.ok) throw new FIANativeError(response.error.code, response.error.message);
  return response.value as Result;
}

function isNativeEvent(value: unknown): value is FIANativeEvent {
  if (!isObject(value) || typeof value.type !== "string") return false;
  if (value.type === "stateChanged") return isObject(value.state);
  return value.type === "statusBarClicked" && value.button === "left";
}

export const native = {
  isAvailable(): boolean {
    return messageHandler() !== undefined;
  },

  async getState(): Promise<FIANativeState> {
    return await invoke<FIANativeState>("native.getState");
  },

  onEvent(listener: (event: FIANativeEvent) => void): () => void {
    const receive = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isNativeEvent(detail)) listener(detail);
    };
    globalThis.addEventListener(EVENT_NAME, receive);
    return () => globalThis.removeEventListener(EVENT_NAME, receive);
  },

  app: {
    async quit(): Promise<void> {
      await invoke<void>("app.quit");
    },
    async showDock(): Promise<FIANativeState> {
      return await invoke<FIANativeState>("app.showDock");
    },
    async hideDock(): Promise<FIANativeState> {
      return await invoke<FIANativeState>("app.hideDock");
    },
  },

  window: {
    async show(): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.show");
    },
    async hide(): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.hide");
    },
    async focus(): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.focus");
    },
    async setAlwaysOnTop(enabled: boolean): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.setAlwaysOnTop", { enabled });
    },
    async setVisibleOnAllSpaces(enabled: boolean): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.setVisibleOnAllSpaces", { enabled });
    },
    async setVisibleOverFullScreen(enabled: boolean): Promise<FIANativeState> {
      return await invoke<FIANativeState>("window.setVisibleOverFullScreen", { enabled });
    },
  },

  statusBar: {
    async setVisible(visible: boolean): Promise<FIANativeState> {
      return await invoke<FIANativeState>("statusBar.setVisible", { visible });
    },
    async setIcon(symbol: string): Promise<FIANativeState> {
      return await invoke<FIANativeState>("statusBar.setIcon", { symbol });
    },
  },
} as const;
