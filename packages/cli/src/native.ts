import { mcp } from "./mcp.ts";

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

const EVENT_NAME = "fia:native-event";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNativeEvent(value: unknown): value is FIANativeEvent {
  if (!isObject(value) || typeof value.type !== "string") return false;
  if (value.type === "stateChanged") return isObject(value.state);
  return value.type === "statusBarClicked" && value.button === "left";
}

function resultValue(value: unknown): unknown {
  if (!isObject(value)) return value;
  if ("structuredContent" in value) return value.structuredContent;
  const content = value.content;
  if (Array.isArray(content)) {
    const text = content.find((item) => isObject(item) && item.type === "text" && typeof item.text === "string");
    if (isObject(text) && typeof text.text === "string") {
      try {
        return JSON.parse(text.text);
      } catch {
        return text.text;
      }
    }
  }
  return value;
}

const nativeErrorCodes = new Set<FIANativeErrorCode>([
  "BRIDGE_UNAVAILABLE",
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "UNKNOWN_COMMAND",
  "INVALID_ARGUMENT",
  "UNSAFE_STATE",
  "NATIVE_FAILURE",
]);

function mappedError(error: unknown): FIANativeError {
  if (isObject(error) && isObject(error.data) && typeof error.data.code === "string"
    && nativeErrorCodes.has(error.data.code as FIANativeErrorCode)) {
    return new FIANativeError(
      error.data.code as FIANativeErrorCode,
      error instanceof Error ? error.message : "The native MCP request failed",
      { cause: error },
    );
  }
  return new FIANativeError(
    "NATIVE_FAILURE",
    error instanceof Error ? error.message : "The native MCP request failed",
    { cause: error },
  );
}

async function invoke<Result>(command: string, params: Record<string, unknown> = {}): Promise<Result> {
  if (!mcp.isAvailable()) {
    throw new FIANativeError("BRIDGE_UNAVAILABLE", "The FIA MCP bridge is unavailable in this environment");
  }
  try {
    const response = await mcp.server("fia.native").callTool({ name: command, arguments: params });
    if (response.isError === true) {
      throw new FIANativeError("NATIVE_FAILURE", "The native MCP tool returned an error");
    }
    return resultValue(response) as Result;
  } catch (error) {
    if (error instanceof FIANativeError) throw error;
    throw mappedError(error);
  }
}

export const native = {
  isAvailable(): boolean {
    return mcp.isAvailable();
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
