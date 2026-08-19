import { HostError } from "./desktop.ts";
import type { CallOptions, RawHostClient, RawMenuNode } from "./desktop.ts";

interface RawCallOptions extends CallOptions {
  readonly timeout?: boolean;
}

export interface RawCallPeer {
  call<Result>(
    method: string,
    params?: Record<string, unknown>,
    options?: RawCallOptions,
  ): Promise<Result>;
  on(event: string, listener: (payload: unknown) => void): () => void;
}

export interface RawSessionGuard {
  authorizeURL(url: string): string;
}

function validateMenu(nodes: readonly RawMenuNode[]): void {
  const ids = new Set<string>();
  let count = 0;
  const visit = (values: readonly RawMenuNode[], depth: number): void => {
    if (depth > 8) throw new HostError("INVALID_ARGUMENT", "Status menu exceeds eight levels");
    for (const node of values) {
      count += 1;
      if (count > 256) throw new HostError("INVALID_ARGUMENT", "Status menu exceeds 256 nodes");
      if (node.type === "separator") continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.id) || node.id.startsWith("fia.")) {
        throw new HostError("INVALID_ARGUMENT", `Invalid or reserved status menu ID: ${node.id}`);
      }
      if (ids.has(node.id)) {
        throw new HostError("INVALID_ARGUMENT", `Duplicate status menu ID: ${node.id}`);
      }
      ids.add(node.id);
      if (node.title.length === 0 || node.title.length > 256) {
        throw new HostError("INVALID_ARGUMENT", `Invalid title for status menu item: ${node.id}`);
      }
      for (const field of ["enabled", "hidden", "checked"] as const) {
        if (node[field] !== undefined && typeof node[field] !== "boolean") {
          throw new HostError("INVALID_ARGUMENT", `${field} must be a boolean: ${node.id}`);
        }
      }
      if (
        node.symbol !== undefined &&
        (typeof node.symbol !== "string" || node.symbol.length === 0)
      ) {
        throw new HostError("INVALID_ARGUMENT", `Invalid SF Symbol: ${node.id}`);
      }
      if (node.shortcut !== undefined) {
        const modifiers = node.shortcut.modifiers ?? [];
        if (
          typeof node.shortcut.key !== "string" ||
          [...node.shortcut.key].length !== 1 ||
          modifiers.some(
            (modifier) => !(["command", "option", "control", "shift"] as const).includes(modifier),
          )
        ) {
          throw new HostError("INVALID_ARGUMENT", `Invalid shortcut: ${node.id}`);
        }
      }
      if (node.children !== undefined) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 1);
}

function eventListener<Value>(
  peer: RawCallPeer,
  event: string,
  listener: (value: Value) => void,
  scope: HostEventScope,
): () => void {
  return scope.add(peer.on(event, (payload) => listener(payload as Value)));
}

export class HostEventScope {
  readonly #removers = new Set<() => void>();
  #disposed = false;

  add(remove: () => void): () => void {
    if (this.#disposed) {
      remove();
      return () => {};
    }
    let active = true;
    const scopedRemove = (): void => {
      if (!active) return;
      active = false;
      this.#removers.delete(scopedRemove);
      remove();
    };
    this.#removers.add(scopedRemove);
    return scopedRemove;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const remove of this.#removers) remove();
  }
}

export function createRawHost(
  peer: RawCallPeer,
  session: RawSessionGuard,
  events: HostEventScope,
): RawHostClient {
  return {
    application: {
      getState: (callOptions) => peer.call("application.getState", {}, callOptions),
      quit: (callOptions) => peer.call("application.quit", {}, callOptions),
      setDockVisible: (visible, callOptions) =>
        peer.call("application.setDockVisible", { visible }, callOptions),
      onReopen: (listener) => eventListener(peer, "application.reopen", () => listener(), events),
    },
    statusItem: {
      setVisible: (visible, callOptions) =>
        peer.call("statusItem.setVisible", { visible }, callOptions),
      setSymbol: (symbol, callOptions) =>
        peer.call("statusItem.setSymbol", { symbol }, callOptions),
      setTooltip: (tooltip, callOptions) =>
        peer.call("statusItem.setTooltip", { tooltip }, callOptions),
      setMenu: async (menu, callOptions) => {
        validateMenu(menu);
        await peer.call("statusItem.setMenu", { menu }, callOptions);
      },
      updateMenuItem: (id, patch, callOptions) =>
        peer.call("statusItem.updateMenuItem", { id, patch }, callOptions),
      onClick: (listener) => eventListener(peer, "statusItem.clicked", listener, events),
      onAction: (listener) => eventListener(peer, "statusItem.action", listener, events),
    },
    webviews: {
      open: (options, callOptions) =>
        peer.call(
          "webviews.open",
          { ...options, url: session.authorizeURL(options.url) },
          callOptions,
        ),
      navigate: (id, url, callOptions) =>
        peer.call("webviews.navigate", { id, url: session.authorizeURL(url) }, callOptions),
      show: (id, callOptions) => peer.call("webviews.show", { id }, callOptions),
      hide: (id, callOptions) => peer.call("webviews.hide", { id }, callOptions),
      focus: (id, callOptions) => peer.call("webviews.focus", { id }, callOptions),
      minimize: (id, callOptions) => peer.call("webviews.minimize", { id }, callOptions),
      maximize: (id, callOptions) => peer.call("webviews.maximize", { id }, callOptions),
      restore: (id, callOptions) => peer.call("webviews.restore", { id }, callOptions),
      setFullScreen: (id, fullScreen, callOptions) =>
        peer.call("webviews.setFullScreen", { id, fullScreen }, callOptions),
      close: (id, callOptions) => peer.call("webviews.close", { id }, callOptions),
      update: (id, options, callOptions) =>
        peer.call("webviews.update", { id, ...options }, callOptions),
      list: (callOptions) => peer.call("webviews.list", {}, callOptions),
      onEvent: (listener) => eventListener(peer, "webviews.event", listener, events),
    },
    system: {
      openURL: (url, callOptions) =>
        peer.call("system.openURL", { url: session.authorizeURL(String(url)) }, callOptions),
      openPath: (path, callOptions) => peer.call("system.openPath", { path }, callOptions),
      revealPath: (path, callOptions) => peer.call("system.revealPath", { path }, callOptions),
      trashPath: (path, callOptions) => peer.call("system.trashPath", { path }, callOptions),
    },
    globalShortcuts: {
      set: (shortcuts, callOptions) => peer.call("globalShortcuts.set", { shortcuts }, callOptions),
      onPressed: (listener) => eventListener(peer, "globalShortcuts.pressed", listener, events),
    },
    screens: {
      list: (callOptions) => peer.call("screens.list", {}, callOptions),
    },
    screenCapture: {
      getAuthorizationStatus: (callOptions) =>
        peer.call("screenCapture.getAuthorizationStatus", {}, callOptions),
      requestAuthorization: (callOptions) =>
        peer.call("screenCapture.requestAuthorization", {}, { ...callOptions, timeout: false }),
      capture: (options, callOptions) =>
        peer.call("screenCapture.capture", { ...options }, callOptions),
    },
    notifications: {
      getAuthorizationStatus: (callOptions) =>
        peer.call("notifications.getAuthorizationStatus", {}, callOptions),
      requestAuthorization: (callOptions) =>
        peer.call("notifications.requestAuthorization", {}, { ...callOptions, timeout: false }),
      send: (options, callOptions) => peer.call("notifications.send", { ...options }, callOptions),
      remove: (id, callOptions) => peer.call("notifications.remove", { id }, callOptions),
      removeAll: (callOptions) => peer.call("notifications.removeAll", {}, callOptions),
      onClick: (listener) => eventListener(peer, "notifications.clicked", listener, events),
    },
    dialogs: {
      openFile: (options = {}, callOptions) =>
        peer.call("dialogs.openFile", { ...options }, { ...callOptions, timeout: false }),
      openDirectory: (options = {}, callOptions) =>
        peer.call("dialogs.openDirectory", { ...options }, { ...callOptions, timeout: false }),
      saveFile: (options = {}, callOptions) =>
        peer.call("dialogs.saveFile", { ...options }, { ...callOptions, timeout: false }),
    },
    clipboard: {
      readText: (callOptions) => peer.call("clipboard.readText", {}, callOptions),
      writeText: (text, callOptions) => peer.call("clipboard.writeText", { text }, callOptions),
      writeImage: (path, callOptions) => peer.call("clipboard.writeImage", { path }, callOptions),
      clear: (callOptions) => peer.call("clipboard.clear", {}, callOptions),
    },
    keychain: {
      get: (key, callOptions) => peer.call("keychain.get", { key }, callOptions),
      set: (key, value, callOptions) => peer.call("keychain.set", { key, value }, callOptions),
      delete: (key, callOptions) => peer.call("keychain.delete", { key }, callOptions),
    },
  };
}
