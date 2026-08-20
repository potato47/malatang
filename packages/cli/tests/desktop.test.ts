import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  DesktopSession,
  HostError,
  type MenuItem,
  type RawHostClient,
  type RawMenuNode,
  type RawWindowOpenOptions,
  type RawWindowState,
  type RawWindowUpdateOptions,
} from "../src/desktop.ts";

function windowState(id: string, overrides: Partial<RawWindowState> = {}): RawWindowState {
  return {
    id,
    url: "https://app.invalid/",
    title: id,
    visible: true,
    focused: false,
    minimized: false,
    maximized: false,
    fullScreen: false,
    windowStyle: "native",
    transparent: false,
    shadow: true,
    resizable: true,
    dragRegion: null,
    frame: { x: 0, y: 0, width: 800, height: 600 },
    alwaysOnTop: false,
    visibleOnAllSpaces: false,
    visibleOverFullScreen: false,
    ...overrides,
  };
}

interface RawFixture {
  readonly desktop: DesktopSession;
  readonly raw: RawHostClient;
  readonly states: Map<string, RawWindowState>;
  readonly calls: Array<{ method: string; value?: unknown }>;
  emitWindow(event: { type: "changed" | "closed"; window: RawWindowState }): void;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function rawFixture(): RawFixture {
  const states = new Map<string, RawWindowState>();
  const calls: Array<{ method: string; value?: unknown }> = [];
  let windowListener: (event: {
    type: "changed" | "closed";
    window: RawWindowState;
  }) => void = () => {};

  const mutate = async (
    method: string,
    id: string,
    patch: Partial<RawWindowState>,
    value: unknown = { id, ...patch },
  ): Promise<RawWindowState> => {
    calls.push({ method, value });
    const current = states.get(id);
    if (current === undefined) throw new HostError("NOT_FOUND", "missing");
    const next = windowState(id, { ...current, ...patch });
    states.set(id, next);
    return next;
  };

  const raw = {
    application: {
      getState: async () => ({ dockVisible: true, statusItemVisible: true }),
      quit: async () => {},
      setDockVisible: async (visible: boolean) => ({
        dockVisible: visible,
        statusItemVisible: true,
      }),
      onReopen: () => () => {},
    },
    statusItem: {
      setVisible: async (visible: boolean) => ({
        dockVisible: true,
        statusItemVisible: visible,
      }),
      setSymbol: async () => {},
      setTooltip: async () => {},
      setMenu: async (menu: readonly RawMenuNode[]) => {
        calls.push({ method: "statusItem.setMenu", value: menu });
      },
      updateMenuItem: async (id: string, patch: unknown) => {
        calls.push({ method: "statusItem.updateMenuItem", value: { id, patch } });
      },
      onClick: () => () => {},
      onAction: () => () => {},
    },
    webviews: {
      open: async (options: RawWindowOpenOptions) => {
        calls.push({ method: "webviews.open", value: options });
        const current = states.get(options.id);
        const next = windowState(options.id, {
          ...current,
          url: options.url,
          title: options.title ?? current?.title ?? options.id,
          windowStyle: options.windowStyle ?? current?.windowStyle ?? "native",
        });
        states.set(options.id, next);
        return next;
      },
      navigate: (id: string, url: string) => mutate("webviews.navigate", id, { url }),
      show: (id: string) => mutate("webviews.show", id, { visible: true }),
      hide: (id: string) => mutate("webviews.hide", id, { visible: false }),
      focus: (id: string) => mutate("webviews.focus", id, { focused: true }),
      minimize: (id: string) => mutate("webviews.minimize", id, { minimized: true }),
      maximize: (id: string) => mutate("webviews.maximize", id, { maximized: true }),
      restore: (id: string) =>
        mutate("webviews.restore", id, { minimized: false, maximized: false }),
      setFullScreen: (id: string, fullScreen: boolean) =>
        mutate("webviews.setFullScreen", id, { fullScreen }),
      close: async (id: string) => {
        calls.push({ method: "webviews.close", value: { id } });
        states.delete(id);
      },
      update: (id: string, options: RawWindowUpdateOptions) => {
        const current = states.get(id);
        const frame = current?.frame ?? windowState(id).frame;
        return mutate(
          "webviews.update",
          id,
          {
            ...(options.title === undefined ? {} : { title: options.title }),
            frame: {
              x: options.x ?? frame.x,
              y: options.y ?? frame.y,
              width: options.width ?? frame.width,
              height: options.height ?? frame.height,
            },
            ...(options.alwaysOnTop === undefined ? {} : { alwaysOnTop: options.alwaysOnTop }),
            ...(options.visibleOnAllSpaces === undefined
              ? {}
              : { visibleOnAllSpaces: options.visibleOnAllSpaces }),
            ...(options.visibleOverFullScreen === undefined
              ? {}
              : { visibleOverFullScreen: options.visibleOverFullScreen }),
          },
          { id, ...options },
        );
      },
      list: async () => {
        calls.push({ method: "webviews.list" });
        return [...states.values()];
      },
      onEvent: (
        listener: (event: { type: "changed" | "closed"; window: RawWindowState }) => void,
      ) => {
        windowListener = listener;
        return () => {};
      },
    },
    system: {},
    globalShortcuts: { set: async () => {}, onPressed: () => () => {} },
    screens: {},
    screenCapture: {
      getAuthorizationStatus: async () => "authorized",
      requestAuthorization: async () => "authorized",
      capture: async (options: { destination: string }) => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        await Bun.write(options.destination, bytes);
        calls.push({ method: "screenCapture.capture", value: options });
        return {
          path: options.destination,
          byteSize: bytes.byteLength,
          pixelWidth: 200,
          pixelHeight: 160,
        };
      },
    },
    notifications: {
      getAuthorizationStatus: async () => "authorized",
      requestAuthorization: async () => "authorized",
      send: async () => ({ id: "notification" }),
      remove: async () => {},
      removeAll: async () => {},
      onClick: () => () => {},
    },
    dialogs: {},
    clipboard: {
      writeImage: async (path: string) => {
        calls.push({ method: "clipboard.writeImage", value: { path } });
      },
    },
    keychain: {},
  } as unknown as RawHostClient;

  const dataDirectory = resolve(tmpdir(), `fia-desktop-${crypto.randomUUID()}`);
  temporaryDirectories.push(dataDirectory);
  return {
    desktop: new DesktopSession(raw, dataDirectory),
    raw,
    states,
    calls,
    emitWindow: (event) => windowListener(event),
  };
}

describe("Desktop resource facade", () => {
  test("keeps handle identity, immutable state, and deduplicated events", async () => {
    const fixture = rawFixture();
    const main = await fixture.desktop.windows.create({
      id: "main",
      url: new URL("https://app.invalid/main"),
      frameless: true,
    });
    expect(fixture.calls[0]).toEqual({
      method: "webviews.open",
      value: {
        id: "main",
        url: "https://app.invalid/main",
        windowStyle: "borderless",
      },
    });
    expect(main.state.frameless).toBe(true);
    expect(Object.isFrozen(main.state)).toBe(true);
    expect(Object.isFrozen(main.state.frame)).toBe(true);

    let changes = 0;
    let closes = 0;
    main.addEventListener("change", ({ detail }) => {
      changes += 1;
      expect(detail.previousState).not.toBe(detail.state);
    });
    main.addEventListener("close", () => {
      closes += 1;
    });

    const adopted = await fixture.desktop.windows.create({
      id: "main",
      url: "https://app.invalid/next",
      title: "Next",
      frameless: true,
    });
    expect(adopted).toBe(main);
    expect(main.state.title).toBe("Next");
    expect(changes).toBe(1);

    fixture.emitWindow({
      type: "changed",
      window: fixture.states.get("main")!,
    });
    expect(changes).toBe(1);
    const changed = windowState("main", {
      ...fixture.states.get("main"),
      title: "From Host",
      windowStyle: "borderless",
    });
    fixture.states.set("main", changed);
    fixture.emitWindow({ type: "changed", window: changed });
    expect(main.state.title).toBe("From Host");
    expect(changes).toBe(2);

    await main.close();
    expect(main.closed).toBe(true);
    expect(closes).toBe(1);
    await expect(main.show()).rejects.toMatchObject({ code: "UNSAFE_STATE" });
    const recreated = await fixture.desktop.windows.create({
      id: "main",
      url: "https://app.invalid/recreated",
    });
    expect(recreated).not.toBe(main);
  });

  test("refreshes get/list and invalidates missing or disposed handles", async () => {
    const fixture = rawFixture();
    const first = await fixture.desktop.windows.create({
      id: "first",
      url: "https://app.invalid/first",
    });
    const second = await fixture.desktop.windows.create({
      id: "second",
      url: "https://app.invalid/second",
    });
    expect(await fixture.desktop.windows.get("first")).toBe(first);
    fixture.states.delete("second");
    expect(await fixture.desktop.windows.list()).toEqual([first]);
    expect(second.closed).toBe(true);
    await expect(
      fixture.desktop.windows.create({ id: "", url: "https://app.invalid" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await fixture.desktop.dispose();
    await expect(first.refresh()).rejects.toMatchObject({ code: "UNSAFE_STATE" });

    const dataDirectory = resolve(tmpdir(), `fia-desktop-${crypto.randomUUID()}`);
    temporaryDirectories.push(dataDirectory);
    const restarted = new DesktopSession(fixture.raw, dataDirectory);
    const adopted = await restarted.windows.create({
      id: "first",
      url: "https://app.invalid/restarted",
    });
    expect(adopted).not.toBe(first);
    expect(adopted.id).toBe("first");
  });

  test("maps every BrowserWindow mutation to the existing raw methods and parameters", async () => {
    const fixture = rawFixture();
    const window = await fixture.desktop.windows.create({
      id: "main",
      url: "https://app.invalid/",
    });
    fixture.calls.length = 0;

    await window.navigate(new URL("https://app.invalid/next"));
    await window.show();
    await window.hide();
    await window.focus();
    await window.minimize();
    await window.maximize();
    await window.restore();
    await window.setFullScreen(true);
    await window.setTitle("Renamed");
    await window.setSize(900, 650);
    await window.setMinimumSize(500, 320);
    await window.setPosition(120, 80);
    await window.setCloseBehavior("close");
    await window.setAlwaysOnTop(true);
    await window.setVisibleOnAllSpaces(true);
    await window.setVisibleOverFullScreen(true);

    expect(fixture.calls).toEqual([
      {
        method: "webviews.navigate",
        value: { id: "main", url: "https://app.invalid/next" },
      },
      { method: "webviews.show", value: { id: "main", visible: true } },
      { method: "webviews.hide", value: { id: "main", visible: false } },
      { method: "webviews.focus", value: { id: "main", focused: true } },
      { method: "webviews.minimize", value: { id: "main", minimized: true } },
      { method: "webviews.maximize", value: { id: "main", maximized: true } },
      {
        method: "webviews.restore",
        value: { id: "main", minimized: false, maximized: false },
      },
      { method: "webviews.setFullScreen", value: { id: "main", fullScreen: true } },
      { method: "webviews.update", value: { id: "main", title: "Renamed" } },
      { method: "webviews.update", value: { id: "main", width: 900, height: 650 } },
      {
        method: "webviews.update",
        value: { id: "main", minWidth: 500, minHeight: 320 },
      },
      { method: "webviews.update", value: { id: "main", x: 120, y: 80 } },
      { method: "webviews.update", value: { id: "main", closeBehavior: "close" } },
      { method: "webviews.update", value: { id: "main", alwaysOnTop: true } },
      { method: "webviews.update", value: { id: "main", visibleOnAllSpaces: true } },
      { method: "webviews.update", value: { id: "main", visibleOverFullScreen: true } },
    ]);
  });

  test("wraps captures as managed file-backed images and accepts them in the clipboard", async () => {
    const fixture = rawFixture();
    const image = await fixture.desktop.screenCapture.capture({
      screenId: "main",
      region: { x: 1, y: 2, width: 100, height: 80 },
      showsCursor: true,
    });
    expect(image.type).toBe("image/png");
    expect(image.size).toBe(4);
    expect(image.pixelWidth).toBe(200);
    expect(image.pixelHeight).toBe(160);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));

    const captureCall = fixture.calls.find((call) => call.method === "screenCapture.capture");
    if (captureCall === undefined) throw new Error("missing screenCapture.capture call");
    expect(captureCall.value).toMatchObject({
      screenId: "main",
      region: { x: 1, y: 2, width: 100, height: 80 },
      showsCursor: true,
    });
    const temporaryPath = (captureCall.value as { destination: string }).destination;
    expect(temporaryPath).toContain("/NativePayloads/");
    expect(await Bun.file(temporaryPath).exists()).toBe(true);

    const savedPath = resolve(tmpdir(), `fia-saved-${crypto.randomUUID()}.png`);
    temporaryDirectories.push(savedPath);
    await image.saveTo(savedPath);
    expect(new Uint8Array(await Bun.file(savedPath).arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    await fixture.desktop.clipboard.writeImage(image);
    expect(fixture.calls.at(-1)).toEqual({
      method: "clipboard.writeImage",
      value: { path: temporaryPath },
    });

    await image.dispose();
    await image.dispose();
    expect(image.disposed).toBe(true);
    expect(await Bun.file(temporaryPath).exists()).toBe(false);
    expect(() => image.file).toThrow("disposed");

    const streamed = await fixture.desktop.screenCapture.capture({ screenId: "main" });
    const streamedCall = fixture.calls.findLast((call) => call.method === "screenCapture.capture");
    if (streamedCall === undefined) throw new Error("missing streamed screenCapture.capture call");
    const streamedPath = (streamedCall.value as { destination: string }).destination;
    expect(
      new Uint8Array(await new Response(streamed.stream({ dispose: true })).arrayBuffer()),
    ).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(streamed.disposed).toBe(true);
    expect(await Bun.file(streamedPath).exists()).toBe(false);

    const pending = await fixture.desktop.screenCapture.capture({ screenId: "main" });
    const pendingCall = fixture.calls.findLast((call) => call.method === "screenCapture.capture");
    if (pendingCall === undefined) throw new Error("missing second screenCapture.capture call");
    const pendingPath = (pendingCall.value as { destination: string }).destination;
    await fixture.desktop.dispose();
    expect(pending.disposed).toBe(true);
    expect(await Bun.file(pendingPath).exists()).toBe(false);
  });

  test("converts tagged menus and strictly validates IDs, limits, and accelerators", async () => {
    const fixture = rawFixture();
    await fixture.desktop.tray.setMenu([
      {
        submenu: {
          id: "tools",
          label: "Tools",
          items: [
            {
              item: {
                id: "capture",
                label: "Capture",
                accelerator: "CmdOrCtrl+Shift+Space",
              },
            },
          ],
        },
      },
      "separator",
    ]);
    expect(fixture.calls.at(-1)).toEqual({
      method: "statusItem.setMenu",
      value: [
        {
          type: "item",
          id: "tools",
          title: "Tools",
          children: [
            {
              type: "item",
              id: "capture",
              title: "Capture",
              shortcut: { key: " ", modifiers: ["command", "shift"] },
            },
          ],
        },
        { type: "separator" },
      ],
    });
    await fixture.desktop.tray.updateMenuItem("capture", {
      label: "Capture screen",
      accelerator: null,
    });
    expect(fixture.calls.at(-1)).toEqual({
      method: "statusItem.updateMenuItem",
      value: {
        id: "capture",
        patch: { title: "Capture screen", shortcut: null },
      },
    });

    await expect(
      fixture.desktop.tray.setMenu([
        { item: { id: "same", label: "A" } },
        { item: { id: "same", label: "B" } },
      ]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      fixture.desktop.tray.setMenu([{ item: { id: "fia.quit", label: "Reserved" } }]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    for (const value of ["Cmd+Command+K", "Meta+K", "Shift", "Cmd+F12"]) {
      await expect(
        fixture.desktop.tray.setMenu([
          { item: { id: "invalid", label: "Invalid", accelerator: value } },
        ]),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    }
    await expect(
      fixture.desktop.tray.setMenu(Array.from({ length: 257 }, () => "separator") as MenuItem[]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    let nested: MenuItem[] = [{ item: { id: "leaf", label: "Leaf" } }];
    for (let depth = 8; depth >= 1; depth -= 1) {
      nested = [
        {
          submenu: {
            id: "level-" + depth,
            label: "Level " + depth,
            items: nested,
          },
        },
      ];
    }
    await expect(fixture.desktop.tray.setMenu(nested)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
