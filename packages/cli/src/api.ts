// Shared typed native API. The browser and Bun use the same contract.
import type { NativeCallOptions, NativeTransport } from "./client.ts";
export type BuiltinApplicationInfo = {
  readonly name: string;
  readonly identifier: string;
  readonly version: string;
  readonly build: number;
};

export type BuiltinClipboardText = {
  readonly text: string;
};

export type BuiltinOpenFilesInput = {
  readonly multiple: boolean;
};

export type BuiltinSaveFileInput = {
  readonly suggestedName?: string;
};

export type BuiltinKeyInput = {
  readonly key: string;
};

export type BuiltinKeyValueInput = {
  readonly key: string;
  readonly value: string;
};

export type BuiltinNotificationInput = {
  readonly title: string;
  readonly body: string;
};

export type BuiltinURLInput = {
  readonly url: string;
};

export type BuiltinPathInput = {
  readonly path: string;
};

export type BuiltinResourceID = {
  readonly id: string;
};

export type BuiltinWindowID = {
  readonly id: string;
};

export type BuiltinWebWindowInput = {
  readonly id: string;
  readonly route: string;
  readonly title: string;
};

export type BuiltinShortcut = {
  readonly id: string;
  readonly key: string;
  readonly modifiers: ReadonlyArray<string>;
};

export type BuiltinShortcutsInput = {
  readonly shortcuts: ReadonlyArray<BuiltinShortcut>;
};

export type BuiltinResourceDescriptor = {
  readonly id: string;
  readonly url: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly expiresAt: string;
};

export type BuiltinWindowState = {
  readonly id: string;
  readonly kind: string;
  readonly lifecycle: string;
  readonly orderedIn: boolean;
  readonly applicationHidden: boolean;
  readonly miniaturized: boolean;
  readonly focused: boolean;
  readonly fullscreen: string;
};

export type BuiltinScreenDescriptor = {
  readonly id: number;
  readonly name: string;
  readonly frame: ReadonlyArray<ReadonlyArray<number>>;
  readonly visibleFrame: ReadonlyArray<ReadonlyArray<number>>;
  readonly scaleFactor: number;
  readonly main: boolean;
};

export function createNativeAPI(transport: NativeTransport) {
  return {
    agent: {
      installCLI: (options?: NativeCallOptions) =>
        transport.call<{ path: string; installed: boolean }>("agent.installCLI", {}, options),
      status: (options?: NativeCallOptions) =>
        transport.call<{ path: string; installed: boolean }>("agent.status", {}, options),
      uninstallCLI: (options?: NativeCallOptions) =>
        transport.call<{ path: string; installed: boolean }>("agent.uninstallCLI", {}, options),
    },
    application: {
      show: (options?: NativeCallOptions) => transport.call("application.show", {}, options),
      info: (options?: NativeCallOptions): Promise<BuiltinApplicationInfo> =>
        transport.call("application.info", {}, options),
      quit: (options?: NativeCallOptions): Promise<Record<string, never>> =>
        transport.call("application.quit", {}, options),
    },
    clipboard: {
      readText: (options?: NativeCallOptions): Promise<string | null> =>
        transport.call("clipboard.readText", {}, options),
      writeText: (
        input: BuiltinClipboardText,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("clipboard.writeText", input, options),
    },
    dialogs: {
      openFiles: (
        input: BuiltinOpenFilesInput,
        options?: NativeCallOptions,
      ): Promise<string[] | null> => transport.call("dialogs.openFiles", input, options),
      saveFile: (
        input: BuiltinSaveFileInput,
        options?: NativeCallOptions,
      ): Promise<string | null> => transport.call("dialogs.saveFile", input, options),
    },
    keychain: {
      get: (input: BuiltinKeyInput, options?: NativeCallOptions): Promise<string | null> =>
        transport.call("keychain.get", input, options),
      set: (
        input: BuiltinKeyValueInput,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("keychain.set", input, options),
      delete: (input: BuiltinKeyInput, options?: NativeCallOptions): Promise<boolean> =>
        transport.call("keychain.delete", input, options),
    },
    notifications: {
      requestAuthorization: (options?: NativeCallOptions): Promise<boolean> =>
        transport.call("notifications.requestAuthorization", {}, options),
      deliver: (
        input: BuiltinNotificationInput,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("notifications.deliver", input, options),
    },
    screens: {
      list: (options?: NativeCallOptions): Promise<BuiltinScreenDescriptor[]> =>
        transport.call("screens.list", {}, options),
    },
    system: {
      openURL: (input: BuiltinURLInput, options?: NativeCallOptions): Promise<boolean> =>
        transport.call("system.openURL", input, options),
      reveal: (
        input: BuiltinPathInput,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("system.reveal", input, options),
    },
    globalShortcuts: {
      set: (
        input: BuiltinShortcutsInput,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("globalShortcuts.set", input, options),
    },
    screen: {
      requestAuthorization: (options?: NativeCallOptions): Promise<boolean> =>
        transport.call("screen.requestAuthorization", {}, options),
      captureRegion: (options?: NativeCallOptions): Promise<BuiltinResourceDescriptor> =>
        transport.call("screen.captureRegion", {}, options),
    },
    resources: {
      dispose: (
        input: BuiltinResourceID,
        options?: NativeCallOptions,
      ): Promise<Record<string, never>> => transport.call("resources.dispose", input, options),
    },
    windows: {
      create: (input: WindowOptions, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.create", input, options),
      update: (input: WindowOptions, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.update", input, options),
      setTitlebar: (
        input: { id: string; items: readonly TitlebarItem[] },
        options?: NativeCallOptions,
      ): Promise<BuiltinWindowState> => transport.call("windows.setTitlebar", input, options),
      open: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.open", input, options),
      hide: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.hide", input, options),
      focus: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.focus", input, options),
      close: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.close", input, options),
      state: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.state", input, options),
      minimize: (
        input: BuiltinWindowID,
        options?: NativeCallOptions,
      ): Promise<BuiltinWindowState> => transport.call("windows.minimize", input, options),
      maximize: (
        input: BuiltinWindowID,
        options?: NativeCallOptions,
      ): Promise<BuiltinWindowState> => transport.call("windows.maximize", input, options),
      restore: (input: BuiltinWindowID, options?: NativeCallOptions): Promise<BuiltinWindowState> =>
        transport.call("windows.restore", input, options),
      toggleFullscreen: (
        input: BuiltinWindowID,
        options?: NativeCallOptions,
      ): Promise<BuiltinWindowState> => transport.call("windows.toggleFullscreen", input, options),
    },
    updates: {
      check: (options?: NativeCallOptions): Promise<UpdateState> =>
        transport.call("updates.check", {}, { timeoutMs: 120_000, ...options }),
      download: (options?: NativeCallOptions): Promise<UpdateState> =>
        transport.call("updates.download", {}, { timeoutMs: 0, ...options }),
      apply: (options?: NativeCallOptions): Promise<UpdateState> =>
        transport.call("updates.apply", {}, { timeoutMs: 0, ...options }),
      state: (options?: NativeCallOptions): Promise<UpdateState> =>
        transport.call("updates.state", {}, options),
    },
  } as const;
}
export type TitlebarItem =
  | {
      type: "button";
      id: string;
      label: string;
      symbol?: string;
      tooltip?: string;
      enabled?: boolean;
    }
  | { type: "text"; id: string; label: string; tooltip?: string }
  | { type: "spacer"; id: string };
export interface WindowOptions {
  id: string;
  route?: string;
  title?: string;
  width?: number;
  height?: number;
  titlebar?: readonly TitlebarItem[];
}
export interface UpdateState {
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "applying"
    | "current"
    | "failed"
    | "requiresInstall";
  version?: string;
  build?: number;
  message?: string;
  downloadURL?: string;
}
