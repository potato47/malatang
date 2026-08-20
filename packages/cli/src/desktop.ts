import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

export type HostErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "UNSAFE_STATE"
  | "NATIVE_FAILURE"
  | "PROTOCOL_FAILURE"
  | "TIMEOUT"
  | "CANCELLED"
  | "CONFLICT"
  | "PERMISSION_DENIED";

export class HostError extends Error {
  readonly code: HostErrorCode;
  readonly details?: unknown;

  constructor(code: HostErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.details = details;
  }
}

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface DesktopState {
  readonly dockVisible: boolean;
  readonly trayVisible: boolean;
}

export interface WindowFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowDragRegion {
  readonly height: number;
  readonly leftInset?: number;
  readonly rightInset?: number;
}

export interface BrowserWindowState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly minimized: boolean;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
  readonly frameless: boolean;
  readonly transparent: boolean;
  readonly shadow: boolean;
  readonly resizable: boolean;
  readonly dragRegion: WindowDragRegion | null;
  readonly frame: WindowFrame;
  readonly alwaysOnTop: boolean;
  readonly visibleOnAllSpaces: boolean;
  readonly visibleOverFullScreen: boolean;
}

export interface BrowserWindowOptions {
  id: string;
  url: string | URL;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
  frameless?: boolean;
  transparent?: boolean;
  shadow?: boolean;
  resizable?: boolean;
  dragRegion?: WindowDragRegion;
  closeBehavior?: "hide" | "close";
  restoreFrame?: boolean;
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
  focus?: boolean;
}

export interface BrowserWindowChangeDetail {
  readonly previousState: BrowserWindowState;
  readonly state: BrowserWindowState;
}

export interface BrowserWindowCloseDetail {
  readonly state: BrowserWindowState;
}

export interface BrowserWindowEventMap {
  change: CustomEvent<BrowserWindowChangeDetail>;
  close: CustomEvent<BrowserWindowCloseDetail>;
}

export interface BrowserWindow {
  readonly id: string;
  readonly state: BrowserWindowState;
  readonly closed: boolean;

  refresh(callOptions?: CallOptions): Promise<BrowserWindowState>;
  navigate(url: string | URL, callOptions?: CallOptions): Promise<void>;
  show(callOptions?: CallOptions): Promise<void>;
  hide(callOptions?: CallOptions): Promise<void>;
  focus(callOptions?: CallOptions): Promise<void>;
  close(callOptions?: CallOptions): Promise<void>;
  minimize(callOptions?: CallOptions): Promise<void>;
  maximize(callOptions?: CallOptions): Promise<void>;
  restore(callOptions?: CallOptions): Promise<void>;
  setFullScreen(fullScreen: boolean, callOptions?: CallOptions): Promise<void>;
  setTitle(title: string, callOptions?: CallOptions): Promise<void>;
  setSize(width: number, height: number, callOptions?: CallOptions): Promise<void>;
  setMinimumSize(width: number, height: number, callOptions?: CallOptions): Promise<void>;
  setPosition(x: number, y: number, callOptions?: CallOptions): Promise<void>;
  setCloseBehavior(closeBehavior: "hide" | "close", callOptions?: CallOptions): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean, callOptions?: CallOptions): Promise<void>;
  setVisibleOnAllSpaces(visible: boolean, callOptions?: CallOptions): Promise<void>;
  setVisibleOverFullScreen(visible: boolean, callOptions?: CallOptions): Promise<void>;

  addEventListener<K extends keyof BrowserWindowEventMap>(
    type: K,
    listener: (this: BrowserWindow, event: BrowserWindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof BrowserWindowEventMap>(
    type: K,
    listener: (this: BrowserWindow, event: BrowserWindowEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface WindowManager {
  create(options: BrowserWindowOptions, callOptions?: CallOptions): Promise<BrowserWindow>;
  get(id: string, callOptions?: CallOptions): Promise<BrowserWindow | null>;
  list(callOptions?: CallOptions): Promise<readonly BrowserWindow[]>;
}

export interface MenuEntry {
  id: string;
  label: string;
  enabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  symbol?: string;
  accelerator?: string;
}

export interface MenuItemEntry {
  item: MenuEntry;
}

export interface SubmenuEntry {
  submenu: MenuEntry & { items: readonly MenuItem[] };
}

export type MenuItem = "separator" | MenuItemEntry | SubmenuEntry;

export interface MenuItemPatch {
  label?: string;
  enabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  symbol?: string | null;
  accelerator?: string | null;
}

export interface MenuClickDetail {
  readonly id: string;
}

export interface TrayClickDetail {
  readonly button: "left";
}

export interface TrayEventMap {
  click: CustomEvent<TrayClickDetail>;
  menuclick: CustomEvent<MenuClickDetail>;
}

export interface Tray {
  setVisible(visible: boolean, callOptions?: CallOptions): Promise<void>;
  setSymbol(symbol: string, callOptions?: CallOptions): Promise<void>;
  setTooltip(tooltip: string, callOptions?: CallOptions): Promise<void>;
  setMenu(menu: readonly MenuItem[], callOptions?: CallOptions): Promise<void>;
  updateMenuItem(id: string, patch: MenuItemPatch, callOptions?: CallOptions): Promise<void>;

  addEventListener<K extends keyof TrayEventMap>(
    type: K,
    listener: (this: Tray, event: TrayEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof TrayEventMap>(
    type: K,
    listener: (this: Tray, event: TrayEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface DockEventMap {
  reopen: Event;
}

export interface Dock {
  setVisible(visible: boolean, callOptions?: CallOptions): Promise<void>;
  addEventListener<K extends keyof DockEventMap>(
    type: K,
    listener: (this: Dock, event: DockEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof DockEventMap>(
    type: K,
    listener: (this: Dock, event: DockEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export type GlobalShortcutModifier = "command" | "option" | "control" | "shift";

export interface GlobalShortcut {
  id: string;
  key: string;
  modifiers: readonly GlobalShortcutModifier[];
}

export interface GlobalShortcutPressedDetail {
  readonly id: string;
}

export interface GlobalShortcutEventMap {
  pressed: CustomEvent<GlobalShortcutPressedDetail>;
}

export interface GlobalShortcuts {
  set(shortcuts: readonly GlobalShortcut[], callOptions?: CallOptions): Promise<void>;
  addEventListener<K extends keyof GlobalShortcutEventMap>(
    type: K,
    listener: (this: GlobalShortcuts, event: GlobalShortcutEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof GlobalShortcutEventMap>(
    type: K,
    listener: (this: GlobalShortcuts, event: GlobalShortcutEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface ScreenInfo {
  readonly id: string;
  readonly name: string;
  readonly frame: WindowFrame;
  readonly visibleFrame: WindowFrame;
  readonly scaleFactor: number;
  readonly main: boolean;
  readonly containsPointer: boolean;
}

export interface ScreenCaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ScreenCaptureAuthorizationStatus = "authorized" | "notAuthorized";
export type ScreenCaptureAuthorizationResult = "authorized" | "restartRequired" | "denied";

export interface ScreenCaptureOptions {
  screenId: string;
  region?: ScreenCaptureRegion;
  showsCursor?: boolean;
}

export interface CapturedImage {
  readonly type: "image/png";
  readonly size: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly file: Bun.BunFile;
  readonly disposed: boolean;

  stream(options?: { readonly dispose?: boolean }): ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  saveTo(destination: string): Promise<void>;
  dispose(): Promise<void>;
}

export type NotificationAuthorizationStatus =
  | "notDetermined"
  | "denied"
  | "authorized"
  | "provisional"
  | "ephemeral"
  | "unknown";

export interface NotificationOptions {
  id?: string;
  title: string;
  subtitle?: string;
  body?: string;
  sound?: boolean;
}

export interface NotificationReceipt {
  readonly id: string;
}

export interface NotificationClickDetail {
  readonly id: string;
}

export interface NotificationEventMap {
  click: CustomEvent<NotificationClickDetail>;
}

export interface Notifications {
  getAuthorizationStatus(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus>;
  requestAuthorization(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus>;
  send(options: NotificationOptions, callOptions?: CallOptions): Promise<NotificationReceipt>;
  remove(id: string, callOptions?: CallOptions): Promise<void>;
  removeAll(callOptions?: CallOptions): Promise<void>;
  addEventListener<K extends keyof NotificationEventMap>(
    type: K,
    listener: (this: Notifications, event: NotificationEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof NotificationEventMap>(
    type: K,
    listener: (this: Notifications, event: NotificationEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface FileDialogOptions {
  title?: string;
  directory?: string;
  showHiddenFiles?: boolean;
}

export interface OpenFileDialogOptions extends FileDialogOptions {
  allowedExtensions?: readonly string[];
  multiple?: boolean;
}

export interface OpenDirectoryDialogOptions extends FileDialogOptions {
  multiple?: boolean;
}

export interface SaveFileDialogOptions extends FileDialogOptions {
  allowedExtensions?: readonly string[];
  name?: string;
  canCreateDirectories?: boolean;
}

export interface Desktop {
  readonly windows: WindowManager;
  readonly tray: Tray;
  readonly dock: Dock;
  readonly system: {
    openURL(url: string | URL, callOptions?: CallOptions): Promise<void>;
    openPath(path: string, callOptions?: CallOptions): Promise<void>;
    revealPath(path: string, callOptions?: CallOptions): Promise<void>;
    trashPath(path: string, callOptions?: CallOptions): Promise<string>;
  };
  readonly globalShortcuts: GlobalShortcuts;
  readonly screens: {
    list(callOptions?: CallOptions): Promise<readonly ScreenInfo[]>;
  };
  readonly screenCapture: {
    getAuthorizationStatus(callOptions?: CallOptions): Promise<ScreenCaptureAuthorizationStatus>;
    requestAuthorization(callOptions?: CallOptions): Promise<ScreenCaptureAuthorizationResult>;
    capture(options: ScreenCaptureOptions, callOptions?: CallOptions): Promise<CapturedImage>;
  };
  readonly notifications: Notifications;
  readonly dialogs: {
    openFile(
      options?: OpenFileDialogOptions,
      callOptions?: CallOptions,
    ): Promise<readonly string[] | null>;
    openDirectory(
      options?: OpenDirectoryDialogOptions,
      callOptions?: CallOptions,
    ): Promise<readonly string[] | null>;
    saveFile(options?: SaveFileDialogOptions, callOptions?: CallOptions): Promise<string | null>;
  };
  readonly clipboard: {
    readText(callOptions?: CallOptions): Promise<string | null>;
    writeText(text: string, callOptions?: CallOptions): Promise<void>;
    writeImage(image: string | CapturedImage, callOptions?: CallOptions): Promise<void>;
    clear(callOptions?: CallOptions): Promise<void>;
  };
  readonly keychain: {
    get(key: string, callOptions?: CallOptions): Promise<string | null>;
    set(key: string, value: string, callOptions?: CallOptions): Promise<void>;
    delete(key: string, callOptions?: CallOptions): Promise<boolean>;
  };
  getState(callOptions?: CallOptions): Promise<DesktopState>;
  quit(callOptions?: CallOptions): Promise<void>;
}

export interface RawWindowState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly minimized: boolean;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
  readonly windowStyle: "native" | "borderless";
  readonly transparent: boolean;
  readonly shadow: boolean;
  readonly resizable: boolean;
  readonly dragRegion: WindowDragRegion | null;
  readonly frame: WindowFrame;
  readonly alwaysOnTop: boolean;
  readonly visibleOnAllSpaces: boolean;
  readonly visibleOverFullScreen: boolean;
}

export interface RawWindowOpenOptions {
  id: string;
  url: string;
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
  windowStyle?: "native" | "borderless";
  transparent?: boolean;
  shadow?: boolean;
  resizable?: boolean;
  dragRegion?: WindowDragRegion;
  closeBehavior?: "hide" | "close";
  restoreFrame?: boolean;
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
  focus?: boolean;
}

export interface RawWindowUpdateOptions {
  title?: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
  closeBehavior?: "hide" | "close";
  alwaysOnTop?: boolean;
  visibleOnAllSpaces?: boolean;
  visibleOverFullScreen?: boolean;
}

export interface RawMenuShortcut {
  key: string;
  modifiers?: readonly GlobalShortcutModifier[];
}

export type RawMenuNode =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      title: string;
      enabled?: boolean;
      hidden?: boolean;
      checked?: boolean;
      symbol?: string;
      shortcut?: RawMenuShortcut;
      children?: readonly RawMenuNode[];
    };

export interface RawMenuItemPatch {
  title?: string;
  enabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  symbol?: string | null;
  shortcut?: RawMenuShortcut | null;
}

export interface RawScreenCaptureOptions extends ScreenCaptureOptions {
  destination: string;
}

export interface RawScreenCaptureReceipt {
  readonly path: string;
  readonly byteSize: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface RawHostClient {
  readonly application: {
    getState(callOptions?: CallOptions): Promise<{
      dockVisible: boolean;
      statusItemVisible: boolean;
    }>;
    quit(callOptions?: CallOptions): Promise<void>;
    setDockVisible(
      visible: boolean,
      callOptions?: CallOptions,
    ): Promise<{ dockVisible: boolean; statusItemVisible: boolean }>;
    onReopen(listener: () => void): () => void;
  };
  readonly statusItem: {
    setVisible(
      visible: boolean,
      callOptions?: CallOptions,
    ): Promise<{ dockVisible: boolean; statusItemVisible: boolean }>;
    setSymbol(symbol: string, callOptions?: CallOptions): Promise<void>;
    setTooltip(tooltip: string, callOptions?: CallOptions): Promise<void>;
    setMenu(menu: readonly RawMenuNode[], callOptions?: CallOptions): Promise<void>;
    updateMenuItem(id: string, patch: RawMenuItemPatch, callOptions?: CallOptions): Promise<void>;
    onClick(listener: (event: TrayClickDetail) => void): () => void;
    onAction(listener: (event: MenuClickDetail) => void): () => void;
  };
  readonly webviews: {
    open(options: RawWindowOpenOptions, callOptions?: CallOptions): Promise<RawWindowState>;
    navigate(id: string, url: string, callOptions?: CallOptions): Promise<RawWindowState>;
    show(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    hide(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    focus(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    minimize(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    maximize(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    restore(id: string, callOptions?: CallOptions): Promise<RawWindowState>;
    setFullScreen(
      id: string,
      fullScreen: boolean,
      callOptions?: CallOptions,
    ): Promise<RawWindowState>;
    close(id: string, callOptions?: CallOptions): Promise<void>;
    update(
      id: string,
      options: RawWindowUpdateOptions,
      callOptions?: CallOptions,
    ): Promise<RawWindowState>;
    list(callOptions?: CallOptions): Promise<readonly RawWindowState[]>;
    onEvent(
      listener: (event: { type: "changed" | "closed"; window: RawWindowState }) => void,
    ): () => void;
  };
  readonly system: Desktop["system"];
  readonly globalShortcuts: {
    set(shortcuts: readonly GlobalShortcut[], callOptions?: CallOptions): Promise<void>;
    onPressed(listener: (event: GlobalShortcutPressedDetail) => void): () => void;
  };
  readonly screens: Desktop["screens"];
  readonly screenCapture: {
    getAuthorizationStatus(callOptions?: CallOptions): Promise<ScreenCaptureAuthorizationStatus>;
    requestAuthorization(callOptions?: CallOptions): Promise<ScreenCaptureAuthorizationResult>;
    capture(
      options: RawScreenCaptureOptions,
      callOptions?: CallOptions,
    ): Promise<RawScreenCaptureReceipt>;
  };
  readonly notifications: {
    getAuthorizationStatus(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus>;
    requestAuthorization(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus>;
    send(options: NotificationOptions, callOptions?: CallOptions): Promise<NotificationReceipt>;
    remove(id: string, callOptions?: CallOptions): Promise<void>;
    removeAll(callOptions?: CallOptions): Promise<void>;
    onClick(listener: (event: NotificationClickDetail) => void): () => void;
  };
  readonly dialogs: Desktop["dialogs"];
  readonly clipboard: {
    readText(callOptions?: CallOptions): Promise<string | null>;
    writeText(text: string, callOptions?: CallOptions): Promise<void>;
    writeImage(path: string, callOptions?: CallOptions): Promise<void>;
    clear(callOptions?: CallOptions): Promise<void>;
  };
  readonly keychain: Desktop["keychain"];
}

function customEvent<Detail>(type: string, detail: Detail): CustomEvent<Detail> {
  return new CustomEvent(type, { detail });
}

function immutableState(raw: RawWindowState): BrowserWindowState {
  const dragRegion = raw.dragRegion === null ? null : Object.freeze({ ...raw.dragRegion });
  const frame = Object.freeze({ ...raw.frame });
  return Object.freeze({
    id: raw.id,
    url: raw.url,
    title: raw.title,
    visible: raw.visible,
    focused: raw.focused,
    minimized: raw.minimized,
    maximized: raw.maximized,
    fullScreen: raw.fullScreen,
    frameless: raw.windowStyle === "borderless",
    transparent: raw.transparent,
    shadow: raw.shadow,
    resizable: raw.resizable,
    dragRegion,
    frame,
    alwaysOnTop: raw.alwaysOnTop,
    visibleOnAllSpaces: raw.visibleOnAllSpaces,
    visibleOverFullScreen: raw.visibleOverFullScreen,
  });
}

function sameState(left: BrowserWindowState, right: BrowserWindowState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertWindowID(id: string): void {
  if (typeof id !== "string" || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new HostError("INVALID_ARGUMENT", `Invalid window ID: ${String(id)}`);
  }
}

function accelerator(value: string): RawMenuShortcut {
  if (value.length === 0 || value !== value.trim()) {
    throw new HostError("INVALID_ARGUMENT", `Invalid menu accelerator: ${JSON.stringify(value)}`);
  }
  const tokens = value.split("+");
  if (tokens.length === 0 || tokens.some((token) => token.length === 0 || token !== token.trim())) {
    throw new HostError("INVALID_ARGUMENT", `Invalid menu accelerator: ${value}`);
  }
  const keyToken = tokens.at(-1)!;
  const modifiers: GlobalShortcutModifier[] = [];
  const seen = new Set<GlobalShortcutModifier>();
  const modifier = (token: string): GlobalShortcutModifier | undefined => {
    switch (token.toLowerCase()) {
      case "cmdorctrl":
      case "cmd":
      case "command":
        return "command";
      case "ctrl":
      case "control":
        return "control";
      case "alt":
      case "option":
        return "option";
      case "shift":
        return "shift";
      default:
        return undefined;
    }
  };
  for (const token of tokens.slice(0, -1)) {
    const resolved = modifier(token);
    if (resolved === undefined || seen.has(resolved)) {
      throw new HostError("INVALID_ARGUMENT", `Invalid menu accelerator: ${value}`);
    }
    seen.add(resolved);
    modifiers.push(resolved);
  }
  if (modifier(keyToken) !== undefined) {
    throw new HostError("INVALID_ARGUMENT", `Menu accelerator is missing a key: ${value}`);
  }
  const key = keyToken.toLowerCase() === "space" ? " " : keyToken;
  if ([...key].length !== 1) {
    throw new HostError("INVALID_ARGUMENT", `Invalid menu accelerator key: ${keyToken}`);
  }
  return { key, ...(modifiers.length === 0 ? {} : { modifiers }) };
}

function rawMenu(nodes: readonly MenuItem[]): readonly RawMenuNode[] {
  const ids = new Set<string>();
  let count = 0;
  const visit = (items: readonly MenuItem[], depth: number): readonly RawMenuNode[] => {
    if (!Array.isArray(items) || depth > 8) {
      throw new HostError("INVALID_ARGUMENT", "Tray menu exceeds 8 levels");
    }
    return items.map((node): RawMenuNode => {
      count += 1;
      if (count > 256) throw new HostError("INVALID_ARGUMENT", "Tray menu exceeds 256 nodes");
      if (node === "separator") return { type: "separator" };
      if (typeof node !== "object" || node === null) {
        throw new HostError("INVALID_ARGUMENT", "Invalid tray menu node");
      }
      const itemNode = Object.hasOwn(node, "item");
      const submenuNode = Object.hasOwn(node, "submenu");
      if (itemNode === submenuNode) {
        throw new HostError("INVALID_ARGUMENT", "Tray menu nodes must contain item or submenu");
      }
      const entry = itemNode ? node.item : node.submenu;
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id) ||
        entry.id.startsWith("fia.")
      ) {
        throw new HostError("INVALID_ARGUMENT", "Invalid or reserved tray menu ID");
      }
      if (ids.has(entry.id)) {
        throw new HostError("INVALID_ARGUMENT", `Duplicate tray menu ID: ${entry.id}`);
      }
      ids.add(entry.id);
      if (typeof entry.label !== "string" || entry.label.length === 0 || entry.label.length > 256) {
        throw new HostError("INVALID_ARGUMENT", `Invalid tray menu label: ${entry.id}`);
      }
      for (const field of ["enabled", "hidden", "checked"] as const) {
        if (entry[field] !== undefined && typeof entry[field] !== "boolean") {
          throw new HostError("INVALID_ARGUMENT", `${field} must be a boolean: ${entry.id}`);
        }
      }
      if (
        entry.symbol !== undefined &&
        (typeof entry.symbol !== "string" || entry.symbol.length === 0)
      ) {
        throw new HostError("INVALID_ARGUMENT", `Invalid SF Symbol: ${entry.id}`);
      }
      if (entry.accelerator !== undefined && typeof entry.accelerator !== "string") {
        throw new HostError("INVALID_ARGUMENT", `Invalid accelerator: ${entry.id}`);
      }
      if (itemNode) {
        const { id, label, accelerator: shortcut, ...rest } = entry as MenuEntry;
        return {
          type: "item",
          id,
          title: label,
          ...rest,
          ...(shortcut === undefined ? {} : { shortcut: accelerator(shortcut) }),
        };
      }
      const {
        id,
        label,
        items: children,
        accelerator: shortcut,
        ...rest
      } = entry as SubmenuEntry["submenu"];
      return {
        type: "item",
        id,
        title: label,
        ...rest,
        ...(shortcut === undefined ? {} : { shortcut: accelerator(shortcut) }),
        children: visit(children, depth + 1),
      };
    });
  };
  return visit(nodes, 1);
}

function rawMenuPatch(patch: MenuItemPatch): RawMenuItemPatch {
  const { label, accelerator: shortcut, ...rest } = patch;
  return {
    ...rest,
    ...(label === undefined ? {} : { title: label }),
    ...(shortcut === undefined
      ? {}
      : { shortcut: shortcut === null ? null : accelerator(shortcut) }),
  };
}

class BrowserWindowHandle extends EventTarget {
  readonly #session: DesktopSession;
  #state: BrowserWindowState;
  #closed = false;

  constructor(session: DesktopSession, state: RawWindowState) {
    super();
    this.#session = session;
    this.#state = immutableState(state);
  }

  get id(): string {
    return this.#state.id;
  }

  get state(): BrowserWindowState {
    return this.#state;
  }

  get closed(): boolean {
    return this.#closed;
  }

  apply(raw: RawWindowState): void {
    if (this.#closed) return;
    const next = immutableState(raw);
    const previousState = this.#state;
    this.#state = next;
    if (!sameState(previousState, next)) {
      this.dispatchEvent(customEvent("change", { previousState, state: next }));
    }
  }

  markClosed(raw?: RawWindowState): void {
    if (this.#closed) return;
    if (raw !== undefined) this.apply(raw);
    this.#closed = true;
    this.dispatchEvent(customEvent("close", { state: this.#state }));
  }

  assertActive(): void {
    this.#session.assertActive();
    if (this.#closed) throw new HostError("UNSAFE_STATE", `BrowserWindow is closed: ${this.id}`);
  }

  refresh(callOptions?: CallOptions): Promise<BrowserWindowState> {
    return this.#session.refreshWindow(this, callOptions);
  }

  async #stateCall(call: () => Promise<RawWindowState>): Promise<void> {
    this.assertActive();
    this.apply(await call());
  }

  navigate(url: string | URL, callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() =>
      this.#session.raw.webviews.navigate(this.id, String(url), callOptions),
    );
  }

  show(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.show(this.id, callOptions));
  }

  hide(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.hide(this.id, callOptions));
  }

  focus(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.focus(this.id, callOptions));
  }

  minimize(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.minimize(this.id, callOptions));
  }

  maximize(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.maximize(this.id, callOptions));
  }

  restore(callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.restore(this.id, callOptions));
  }

  setFullScreen(fullScreen: boolean, callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() =>
      this.#session.raw.webviews.setFullScreen(this.id, fullScreen, callOptions),
    );
  }

  async close(callOptions?: CallOptions): Promise<void> {
    this.assertActive();
    await this.#session.raw.webviews.close(this.id, callOptions);
    this.#session.closeWindow(this);
  }

  #update(options: RawWindowUpdateOptions, callOptions?: CallOptions): Promise<void> {
    return this.#stateCall(() => this.#session.raw.webviews.update(this.id, options, callOptions));
  }

  setTitle(title: string, callOptions?: CallOptions): Promise<void> {
    return this.#update({ title }, callOptions);
  }

  setSize(width: number, height: number, callOptions?: CallOptions): Promise<void> {
    return this.#update({ width, height }, callOptions);
  }

  setMinimumSize(width: number, height: number, callOptions?: CallOptions): Promise<void> {
    return this.#update({ minWidth: width, minHeight: height }, callOptions);
  }

  setPosition(x: number, y: number, callOptions?: CallOptions): Promise<void> {
    return this.#update({ x, y }, callOptions);
  }

  setCloseBehavior(closeBehavior: "hide" | "close", callOptions?: CallOptions): Promise<void> {
    return this.#update({ closeBehavior }, callOptions);
  }

  setAlwaysOnTop(alwaysOnTop: boolean, callOptions?: CallOptions): Promise<void> {
    return this.#update({ alwaysOnTop }, callOptions);
  }

  setVisibleOnAllSpaces(visible: boolean, callOptions?: CallOptions): Promise<void> {
    return this.#update({ visibleOnAllSpaces: visible }, callOptions);
  }

  setVisibleOverFullScreen(visible: boolean, callOptions?: CallOptions): Promise<void> {
    return this.#update({ visibleOverFullScreen: visible }, callOptions);
  }
}

class TrayHandle extends EventTarget {
  readonly #session: DesktopSession;

  constructor(session: DesktopSession) {
    super();
    this.#session = session;
  }

  emitClick(detail: TrayClickDetail): void {
    this.dispatchEvent(customEvent("click", detail));
  }

  emitMenuClick(detail: MenuClickDetail): void {
    this.dispatchEvent(customEvent("menuclick", detail));
  }

  async setVisible(visible: boolean, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    await this.#session.raw.statusItem.setVisible(visible, callOptions);
  }

  setSymbol(symbol: string, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    return this.#session.raw.statusItem.setSymbol(symbol, callOptions);
  }

  setTooltip(tooltip: string, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    return this.#session.raw.statusItem.setTooltip(tooltip, callOptions);
  }

  async setMenu(menu: readonly MenuItem[], callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    await this.#session.raw.statusItem.setMenu(rawMenu(menu), callOptions);
  }

  async updateMenuItem(id: string, patch: MenuItemPatch, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.startsWith("fia.")) {
      throw new HostError("INVALID_ARGUMENT", `Invalid or reserved tray menu ID: ${id}`);
    }
    await this.#session.raw.statusItem.updateMenuItem(id, rawMenuPatch(patch), callOptions);
  }
}

class DockHandle extends EventTarget {
  readonly #session: DesktopSession;

  constructor(session: DesktopSession) {
    super();
    this.#session = session;
  }

  emitReopen(): void {
    this.dispatchEvent(new Event("reopen"));
  }

  async setVisible(visible: boolean, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    await this.#session.raw.application.setDockVisible(visible, callOptions);
  }
}

class GlobalShortcutsHandle extends EventTarget {
  readonly #session: DesktopSession;

  constructor(session: DesktopSession) {
    super();
    this.#session = session;
  }

  emitPressed(detail: GlobalShortcutPressedDetail): void {
    this.dispatchEvent(customEvent("pressed", detail));
  }

  set(shortcuts: readonly GlobalShortcut[], callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    return this.#session.raw.globalShortcuts.set(shortcuts, callOptions);
  }
}

class NotificationsHandle extends EventTarget {
  readonly #session: DesktopSession;

  constructor(session: DesktopSession) {
    super();
    this.#session = session;
  }

  emitClick(detail: NotificationClickDetail): void {
    this.dispatchEvent(customEvent("click", detail));
  }

  getAuthorizationStatus(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus> {
    this.#session.assertActive();
    return this.#session.raw.notifications.getAuthorizationStatus(callOptions);
  }

  requestAuthorization(callOptions?: CallOptions): Promise<NotificationAuthorizationStatus> {
    this.#session.assertActive();
    return this.#session.raw.notifications.requestAuthorization(callOptions);
  }

  send(options: NotificationOptions, callOptions?: CallOptions): Promise<NotificationReceipt> {
    this.#session.assertActive();
    return this.#session.raw.notifications.send(options, callOptions);
  }

  remove(id: string, callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    return this.#session.raw.notifications.remove(id, callOptions);
  }

  removeAll(callOptions?: CallOptions): Promise<void> {
    this.#session.assertActive();
    return this.#session.raw.notifications.removeAll(callOptions);
  }
}

const MAX_CAPTURED_IMAGES = 128;
const MAX_CAPTURED_IMAGE_BYTES = 512 * 1024 * 1024;

class CapturedImageHandle implements CapturedImage {
  readonly type = "image/png" as const;
  readonly size: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly #session: DesktopSession;
  readonly #path: string;
  #disposed = false;

  constructor(session: DesktopSession, path: string, receipt: RawScreenCaptureReceipt) {
    this.#session = session;
    this.#path = path;
    this.size = receipt.byteSize;
    this.pixelWidth = receipt.pixelWidth;
    this.pixelHeight = receipt.pixelHeight;
  }

  get file(): Bun.BunFile {
    this.assertActive();
    return Bun.file(this.#path, { type: this.type });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  stream(options: { readonly dispose?: boolean } = {}): ReadableStream<Uint8Array> {
    const stream = this.file.stream();
    if (options.dispose !== true) return stream;
    const reader = stream.getReader();
    let settled = false;
    const dispose = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      reader.releaseLock();
      await this.dispose();
    };
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const result = await reader.read();
          if (result.done) {
            await dispose();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          await dispose().catch(() => {});
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } finally {
          await dispose();
        }
      },
    });
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.file.arrayBuffer();
  }

  async saveTo(destination: string): Promise<void> {
    this.assertActive();
    if (typeof destination !== "string" || destination.length === 0 || destination.includes("\0")) {
      throw new HostError(
        "INVALID_ARGUMENT",
        "Captured image destination must be a non-empty path",
      );
    }
    await copyFile(this.#path, destination);
  }

  dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    return this.#session.disposeCapturedImage(this);
  }

  assertOwnedBy(session: DesktopSession): string {
    this.assertActive();
    if (session !== this.#session) {
      throw new HostError(
        "INVALID_ARGUMENT",
        "Captured image belongs to a different Desktop session",
      );
    }
    return this.#path;
  }

  markDisposed(): void {
    this.#disposed = true;
  }

  private assertActive(): void {
    this.#session.assertActive();
    if (this.#disposed) throw new HostError("UNSAFE_STATE", "The captured image has been disposed");
  }
}

export class DesktopSession implements Desktop {
  readonly raw: RawHostClient;
  readonly #windowHandles = new Map<string, BrowserWindowHandle>();
  readonly #capturedImages = new Set<CapturedImageHandle>();
  readonly #captureRoot: string;
  readonly #captureDirectory: string;
  #captureDirectoryReady: Promise<void> | undefined;
  #capturedImageBytes = 0;
  #active = true;
  #disposePromise: Promise<void> | undefined;
  readonly #trayHandle: TrayHandle;
  readonly #dockHandle: DockHandle;
  readonly #globalShortcutsHandle: GlobalShortcutsHandle;
  readonly #notificationsHandle: NotificationsHandle;
  readonly tray: Tray;
  readonly dock: Dock;
  readonly globalShortcuts: GlobalShortcuts;
  readonly notifications: Notifications;

  constructor(raw: RawHostClient, dataDirectory: string) {
    this.raw = raw;
    this.#captureRoot = resolve(dataDirectory, "NativePayloads");
    this.#captureDirectory = resolve(this.#captureRoot, crypto.randomUUID());
    this.#trayHandle = new TrayHandle(this);
    this.#dockHandle = new DockHandle(this);
    this.#globalShortcutsHandle = new GlobalShortcutsHandle(this);
    this.#notificationsHandle = new NotificationsHandle(this);
    this.tray = this.#trayHandle as unknown as Tray;
    this.dock = this.#dockHandle as unknown as Dock;
    this.globalShortcuts = this.#globalShortcutsHandle as unknown as GlobalShortcuts;
    this.notifications = this.#notificationsHandle as unknown as Notifications;
    raw.webviews.onEvent((event) => this.#receiveWindowEvent(event));
    raw.statusItem.onClick((event) => this.#trayHandle.emitClick(event));
    raw.statusItem.onAction((event) => this.#trayHandle.emitMenuClick(event));
    raw.application.onReopen(() => this.#dockHandle.emitReopen());
    raw.globalShortcuts.onPressed((event) => this.#globalShortcutsHandle.emitPressed(event));
    raw.notifications.onClick((event) => this.#notificationsHandle.emitClick(event));
  }

  assertActive(): void {
    if (!this.#active)
      throw new HostError("UNSAFE_STATE", "The Desktop session is no longer active");
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise;
    this.#active = false;
    for (const image of this.#capturedImages) image.markDisposed();
    this.#capturedImages.clear();
    this.#capturedImageBytes = 0;
    this.#disposePromise = (async () => {
      if (this.#captureDirectoryReady !== undefined) {
        await this.#captureDirectoryReady.catch(() => {});
        await rm(this.#captureDirectory, { recursive: true, force: true });
      }
    })();
    return this.#disposePromise;
  }

  async disposeCapturedImage(image: CapturedImageHandle): Promise<void> {
    const path = image.assertOwnedBy(this);
    if (!this.#capturedImages.delete(image)) {
      image.markDisposed();
      return;
    }
    image.markDisposed();
    this.#capturedImageBytes -= image.size;
    await rm(path, { force: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  #handle(raw: RawWindowState): BrowserWindowHandle {
    const existing = this.#windowHandles.get(raw.id);
    if (existing !== undefined && !existing.closed) {
      existing.apply(raw);
      return existing;
    }
    const created = new BrowserWindowHandle(this, raw);
    this.#windowHandles.set(raw.id, created);
    return created;
  }

  #receiveWindowEvent(event: { type: "changed" | "closed"; window: RawWindowState }): void {
    if (!this.#active) return;
    const handle = this.#windowHandles.get(event.window.id);
    if (handle === undefined) return;
    if (event.type === "closed") this.closeWindow(handle, event.window);
    else handle.apply(event.window);
  }

  closeWindow(handle: BrowserWindowHandle, raw?: RawWindowState): void {
    if (this.#windowHandles.get(handle.id) === handle) this.#windowHandles.delete(handle.id);
    handle.markClosed(raw);
  }

  async #captureDestination(): Promise<string> {
    this.assertActive();
    if (this.#capturedImages.size >= MAX_CAPTURED_IMAGES) {
      throw new HostError(
        "UNSAFE_STATE",
        `At most ${MAX_CAPTURED_IMAGES} captured images may remain undisposed`,
      );
    }
    this.#captureDirectoryReady ??= (async () => {
      await rm(this.#captureRoot, { recursive: true, force: true });
      await mkdir(this.#captureDirectory, { recursive: true });
    })();
    await this.#captureDirectoryReady;
    this.assertActive();
    return resolve(this.#captureDirectory, `${crypto.randomUUID()}.png`);
  }

  async #captureImage(
    options: ScreenCaptureOptions,
    callOptions?: CallOptions,
  ): Promise<CapturedImage> {
    const destination = await this.#captureDestination();
    try {
      const receipt = await this.raw.screenCapture.capture(
        { ...options, destination },
        callOptions,
      );
      this.assertActive();
      const information = await lstat(destination);
      this.assertActive();
      if (
        receipt.path !== destination ||
        !Number.isSafeInteger(receipt.byteSize) ||
        receipt.byteSize <= 0 ||
        receipt.byteSize !== information.size ||
        !Number.isSafeInteger(receipt.pixelWidth) ||
        receipt.pixelWidth <= 0 ||
        !Number.isSafeInteger(receipt.pixelHeight) ||
        receipt.pixelHeight <= 0 ||
        !information.isFile()
      ) {
        throw new HostError("PROTOCOL_FAILURE", "Host returned an invalid captured image receipt");
      }
      if (this.#capturedImageBytes + receipt.byteSize > MAX_CAPTURED_IMAGE_BYTES) {
        throw new HostError(
          "UNSAFE_STATE",
          "Captured images exceed the 512 MiB temporary storage limit",
        );
      }
      const image = new CapturedImageHandle(this, destination, receipt);
      this.#capturedImages.add(image);
      this.#capturedImageBytes += image.size;
      return image;
    } catch (error) {
      await rm(destination, { force: true }).catch(() => {});
      throw error;
    }
  }

  async #rawWindows(callOptions?: CallOptions): Promise<readonly RawWindowState[]> {
    this.assertActive();
    const states = await this.raw.webviews.list(callOptions);
    const ids = new Set(states.map((state) => state.id));
    for (const [id, handle] of this.#windowHandles) {
      if (!ids.has(id)) this.closeWindow(handle);
    }
    return states;
  }

  readonly windows: WindowManager = {
    create: async (options, callOptions) => {
      this.assertActive();
      assertWindowID(options.id);
      const { frameless, url, ...rest } = options;
      const state = await this.raw.webviews.open(
        {
          ...rest,
          url: String(url),
          ...(frameless === undefined ? {} : { windowStyle: frameless ? "borderless" : "native" }),
        },
        callOptions,
      );
      return this.#handle(state) as unknown as BrowserWindow;
    },
    get: async (id, callOptions) => {
      assertWindowID(id);
      const state = (await this.#rawWindows(callOptions)).find((item) => item.id === id);
      return state === undefined ? null : (this.#handle(state) as unknown as BrowserWindow);
    },
    list: async (callOptions) =>
      (await this.#rawWindows(callOptions)).map(
        (state) => this.#handle(state) as unknown as BrowserWindow,
      ),
  };

  async refreshWindow(
    handle: BrowserWindowHandle,
    callOptions?: CallOptions,
  ): Promise<BrowserWindowState> {
    handle.assertActive();
    const state = (await this.#rawWindows(callOptions)).find((item) => item.id === handle.id);
    if (state === undefined) {
      this.closeWindow(handle);
      throw new HostError("NOT_FOUND", `BrowserWindow not found: ${handle.id}`);
    }
    handle.apply(state);
    return handle.state;
  }

  readonly system: Desktop["system"] = {
    openURL: (url, callOptions) => {
      this.assertActive();
      return this.raw.system.openURL(String(url), callOptions);
    },
    openPath: (path, callOptions) => {
      this.assertActive();
      return this.raw.system.openPath(path, callOptions);
    },
    revealPath: (path, callOptions) => {
      this.assertActive();
      return this.raw.system.revealPath(path, callOptions);
    },
    trashPath: (path, callOptions) => {
      this.assertActive();
      return this.raw.system.trashPath(path, callOptions);
    },
  };

  readonly screens: Desktop["screens"] = {
    list: (callOptions) => {
      this.assertActive();
      return this.raw.screens.list(callOptions);
    },
  };

  readonly screenCapture: Desktop["screenCapture"] = {
    getAuthorizationStatus: (callOptions) => {
      this.assertActive();
      return this.raw.screenCapture.getAuthorizationStatus(callOptions);
    },
    requestAuthorization: (callOptions) => {
      this.assertActive();
      return this.raw.screenCapture.requestAuthorization(callOptions);
    },
    capture: (options, callOptions) => this.#captureImage(options, callOptions),
  };

  readonly dialogs: Desktop["dialogs"] = {
    openFile: (options, callOptions) => {
      this.assertActive();
      return this.raw.dialogs.openFile(options, callOptions);
    },
    openDirectory: (options, callOptions) => {
      this.assertActive();
      return this.raw.dialogs.openDirectory(options, callOptions);
    },
    saveFile: (options, callOptions) => {
      this.assertActive();
      return this.raw.dialogs.saveFile(options, callOptions);
    },
  };

  readonly clipboard: Desktop["clipboard"] = {
    readText: (callOptions) => {
      this.assertActive();
      return this.raw.clipboard.readText(callOptions);
    },
    writeText: (text, callOptions) => {
      this.assertActive();
      return this.raw.clipboard.writeText(text, callOptions);
    },
    writeImage: (image, callOptions) => {
      this.assertActive();
      const path =
        typeof image === "string"
          ? image
          : image instanceof CapturedImageHandle
            ? image.assertOwnedBy(this)
            : undefined;
      if (path === undefined) {
        throw new HostError("INVALID_ARGUMENT", "Image must be a path or FIA captured image");
      }
      return this.raw.clipboard.writeImage(path, callOptions);
    },
    clear: (callOptions) => {
      this.assertActive();
      return this.raw.clipboard.clear(callOptions);
    },
  };

  readonly keychain: Desktop["keychain"] = {
    get: (key, callOptions) => {
      this.assertActive();
      return this.raw.keychain.get(key, callOptions);
    },
    set: (key, value, callOptions) => {
      this.assertActive();
      return this.raw.keychain.set(key, value, callOptions);
    },
    delete: (key, callOptions) => {
      this.assertActive();
      return this.raw.keychain.delete(key, callOptions);
    },
  };

  async getState(callOptions?: CallOptions): Promise<DesktopState> {
    this.assertActive();
    const state = await this.raw.application.getState(callOptions);
    return { dockVisible: state.dockVisible, trayVisible: state.statusItemVisible };
  }

  quit(callOptions?: CallOptions): Promise<void> {
    this.assertActive();
    return this.raw.application.quit(callOptions);
  }
}
