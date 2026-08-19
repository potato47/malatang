import {
  defineBackend,
  HostError,
  type BrowserWindow,
  type BrowserWindowOptions,
  type Desktop,
} from "@semicoder/fia/backend";
import { mkdir } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import page from "./ui/index.html";
import { capabilitySnapshot, type ShortcutState } from "./features/capabilities/service";
import { FileManagerService } from "./features/files/service";
import { SpotlightSearchService } from "./features/search/service";
import { ScreenshotService } from "./features/screenshots/service";
import { ShowcaseRepository } from "./lib/database";
import { EventBroker, type ShowcaseSocketData } from "./lib/events";
import {
  api,
  AppError,
  errorResponse,
  json,
  jsonBody,
  optionalString,
  requiredString,
} from "./lib/http";
import type { ScreenInfo, WindowName } from "./shared/contracts";
import type { ShowcaseSettings } from "./shared/contracts";

interface Runtime {
  repository: ShowcaseRepository;
  screenshots: ScreenshotService;
  search: SpotlightSearchService;
  files: FileManagerService;
  events: EventBroker;
  shortcuts: ShortcutState;
  overlayIds: Set<string>;
}

const broker = new EventBroker();
let runtime: Runtime | null = null;

function active(): Runtime {
  if (runtime === null) throw new AppError("NOT_READY", "应用后端仍在启动", 503);
  return runtime;
}

const windowPaths: Record<WindowName, string> = {
  home: "/",
  screenshots: "/screenshots",
  search: "/search",
  files: "/files",
  capabilities: "/capabilities",
};

const nativeWindows: Record<
  Exclude<WindowName, "search">,
  { title: string; width: number; height: number }
> = {
  home: { title: "FIA 工具箱", width: 1_040, height: 720 },
  screenshots: { title: "截图", width: 1_060, height: 720 },
  files: { title: "文件", width: 1_120, height: 760 },
  capabilities: { title: "能力中心", width: 920, height: 700 },
};

async function windowFor(desktop: Desktop, id: string): Promise<BrowserWindow> {
  const window = await desktop.windows.get(id);
  if (window === null) throw new HostError("NOT_FOUND", `BrowserWindow not found: ${id}`);
  return window;
}

async function openWindow(
  desktop: Desktop,
  makeURL: (path?: string) => URL,
  name: WindowName,
): Promise<void> {
  if (name === "search") {
    const screens = (await desktop.screens.list()) as ScreenInfo[];
    const screen =
      screens.find((item) => item.containsPointer) ??
      screens.find((item) => item.main) ??
      screens[0];
    const width = 720;
    const height = 520;
    const frame = screen?.visibleFrame;
    const options: BrowserWindowOptions = {
      id: "search",
      url: makeURL(windowPaths.search).href,
      title: "文件搜索",
      width,
      height,
      ...(frame === undefined
        ? {}
        : {
            x: Math.round(frame.x + (frame.width - width) / 2),
            y: Math.round(frame.y + Math.max(56, (frame.height - height) * 0.22)),
          }),
      frameless: true,
      transparent: true,
      shadow: true,
      resizable: false,
      closeBehavior: "hide",
      restoreFrame: false,
      alwaysOnTop: true,
      focus: true,
    };
    await desktop.windows.create(options);
    return;
  }
  const configuration = nativeWindows[name];
  await desktop.windows.create({
    id: name,
    url: makeURL(windowPaths[name]).href,
    title: configuration.title,
    width: configuration.width,
    height: configuration.height,
    minWidth: 720,
    minHeight: 520,
    closeBehavior: "hide",
    focus: true,
  });
}

async function closeCaptureOverlays(desktop: Desktop, mode: "hide" | "close"): Promise<void> {
  const ids = [...active().overlayIds];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const window = await windowFor(desktop, id);
        if (mode === "hide") await window.hide();
        else await window.close();
      } catch {
        // Closing/hiding the complete overlay set is intentionally idempotent.
      }
    }),
  );
  if (mode === "close") active().overlayIds.clear();
}

async function openScreenshotPreview(
  desktop: Desktop,
  makeURL: (path?: string) => URL,
  screenshotId: string,
): Promise<void> {
  const parameters = new URLSearchParams({ id: screenshotId });
  await desktop.windows.create({
    id: "screenshot-preview",
    url: makeURL(`/preview?${parameters}`).href,
    title: "截图预览",
    width: 620,
    height: 470,
    minWidth: 460,
    minHeight: 340,
    closeBehavior: "hide",
    restoreFrame: true,
    alwaysOnTop: true,
    focus: true,
  });
}

async function openCaptureOverlays(
  desktop: Desktop,
  makeURL: (path?: string) => URL,
): Promise<void> {
  active().screenshots.beginSelection();
  let screens: ScreenInfo[];
  try {
    screens = (await desktop.screens.list()) as ScreenInfo[];
  } catch (error) {
    active().screenshots.cancelSelection();
    throw error;
  }
  if (screens.length === 0) {
    active().screenshots.cancelSelection();
    throw new AppError("NO_SCREEN", "没有可用于截图的显示器", 409);
  }
  await closeCaptureOverlays(desktop, "close");
  const opened: string[] = [];
  try {
    for (const [index, screen] of screens.entries()) {
      const id = `capture-overlay-${index}`;
      const query = new URLSearchParams({ screenId: screen.id, screenName: screen.name });
      await desktop.windows.create({
        id,
        url: makeURL(`/capture?${query}`).href,
        title: `选择截图区域 · ${screen.name}`,
        x: screen.frame.x,
        y: screen.frame.y,
        width: screen.frame.width,
        height: screen.frame.height,
        frameless: true,
        transparent: true,
        shadow: false,
        resizable: false,
        closeBehavior: "close",
        restoreFrame: false,
        alwaysOnTop: true,
        visibleOnAllSpaces: true,
        visibleOverFullScreen: true,
        focus: screen.containsPointer,
      });
      opened.push(id);
      active().overlayIds.add(id);
    }
  } catch (error) {
    await Promise.all(
      opened.map(async (id) => (await windowFor(desktop, id)).close().catch(() => undefined)),
    );
    active().overlayIds.clear();
    active().screenshots.cancelSelection();
    throw error;
  }
}

async function handleCapabilityAction(
  desktop: Desktop,
  makeURL: (path?: string) => URL,
  action: string,
): Promise<unknown> {
  switch (action) {
    case "request-screen-capture": {
      const status = await desktop.screenCapture.requestAuthorization();
      active().events.publish({ type: "capabilities.changed" });
      return { status };
    }
    case "request-notifications": {
      const status = await desktop.notifications.requestAuthorization();
      active().events.publish({ type: "capabilities.changed" });
      return { status };
    }
    case "send-notification":
      return await desktop.notifications.send({
        id: `showcase-${Date.now()}`,
        title: "FIA 工具箱",
        body: "原生通知链路工作正常。",
      });
    case "copy-text":
      await desktop.clipboard.writeText("来自 FIA 工具箱的剪贴板测试");
      return { copied: true };
    case "keychain-roundtrip": {
      const key = `diagnostic-${crypto.randomUUID()}`;
      const value = crypto.randomUUID();
      await desktop.keychain.set(key, value);
      const restored = await desktop.keychain.get(key);
      await desktop.keychain.delete(key);
      return { matched: restored === value };
    }
    case "choose-file":
      return {
        selected:
          (await desktop.dialogs.openFile({ title: "验证打开文件面板", multiple: true }))?.length ??
          0,
      };
    case "choose-directory":
      return {
        selected:
          (await desktop.dialogs.openDirectory({ title: "验证目录选择面板", multiple: true }))
            ?.length ?? 0,
      };
    case "choose-save":
      return {
        selected:
          (await desktop.dialogs.saveFile({
            title: "验证保存面板（不会写入文件）",
            name: "FIA-Toolbox-test.txt",
            canCreateDirectories: true,
          })) !== null,
      };
    case "copy-latest-image": {
      const latest = active().repository.listScreenshots(1)[0];
      if (latest === undefined)
        throw new AppError("NO_SCREENSHOT", "请先完成一张截图，再验证图片剪贴板", 409);
      await desktop.clipboard.writeImage(latest.path);
      return { copied: true };
    }
    case "open-secondary-window":
      await desktop.windows.create({
        id: "capability-secondary",
        url: makeURL("/capabilities").href,
        title: "FIA 多窗口验证",
        width: 760,
        height: 580,
        closeBehavior: "close",
        focus: true,
      });
      return { opened: true };
    default:
      throw new AppError("UNKNOWN_ACTION", "未知能力验证动作");
  }
}

async function installShortcuts(
  desktop: Desktop,
  makeURL: (path?: string) => URL,
  state: ShortcutState,
  settings: ShowcaseSettings,
): Promise<void> {
  try {
    await desktop.globalShortcuts.set([
      { id: "show-search", ...settings.searchShortcut },
      { id: "capture-region", ...settings.captureShortcut },
    ]);
    state.ready = true;
    state.detail = `${settings.searchShortcut.modifiers.join("+")}+${settings.searchShortcut.key} 打开搜索；${settings.captureShortcut.modifiers.join("+")}+${settings.captureShortcut.key} 区域截图`;
  } catch (error) {
    state.ready = false;
    state.detail = "注册失败：快捷键可能与其他应用冲突";
    console.warn("全局快捷键注册失败", error);
  }
  desktop.globalShortcuts.addEventListener("pressed", ({ detail }) => {
    if (detail.id === "show-search")
      void openWindow(desktop, makeURL, "search").catch(console.error);
    if (detail.id === "capture-region")
      void openCaptureOverlays(desktop, makeURL).catch(console.error);
  });
}

async function statusAction(
  id: string,
  desktop: Desktop,
  makeURL: (path?: string) => URL,
): Promise<void> {
  if (id === "open-home") return await openWindow(desktop, makeURL, "home");
  if (id === "open-search") return await openWindow(desktop, makeURL, "search");
  if (id === "open-files") return await openWindow(desktop, makeURL, "files");
  if (id === "open-screenshots") return await openWindow(desktop, makeURL, "screenshots");
  if (id === "open-capabilities") return await openWindow(desktop, makeURL, "capabilities");
  if (id === "capture-region") return await openCaptureOverlays(desktop, makeURL);
  if (id === "capture-screen") {
    const screenshot = await active().screenshots.capture(desktop, { mode: "screen" });
    await openScreenshotPreview(desktop, makeURL, screenshot.id);
  }
}

export default defineBackend<ShowcaseSocketData>()({
  http: {
    publicRoutes: {
      "/": page,
      "/screenshots": page,
      "/search": page,
      "/files": page,
      "/capabilities": page,
      "/capture": page,
      "/preview": page,
    },
    routes: {
      "/ws": (request, server) => {
        if (server.upgrade(request, { data: { connectedAt: Date.now() } })) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      },
      "/api/overview": {
        GET: api(async () => {
          const state = active();
          return json({
            screenshots: state.screenshots.list(4),
            roots: state.files.roots(),
            recentSearches: state.search.recent(),
          });
        }),
      },
      "/api/windows/:name": {
        POST: api(async (request, _server, { desktop }) => {
          const name = request.params.name as WindowName;
          if (!Object.hasOwn(windowPaths, name)) throw new AppError("UNKNOWN_WINDOW", "未知窗口");
          await openWindow(desktop, (path = "/") => new URL(path, request.url), name);
          return json({ ok: true });
        }),
        DELETE: api(async (request, _server, { desktop }) => {
          const name = request.params.name;
          if (!Object.hasOwn(windowPaths, name)) throw new AppError("UNKNOWN_WINDOW", "未知窗口");
          try {
            await (await windowFor(desktop, name)).hide();
          } catch {
            // Hiding an unopened window is idempotent for the UI.
          }
          return json({ ok: true });
        }),
      },
      "/api/screens": {
        GET: api(async (_request, _server, { desktop }) => json(await desktop.screens.list())),
      },
      "/api/screenshots": {
        GET: api(async (request) => {
          const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
          return json({
            screenshots: active().screenshots.list(Number.isFinite(limit) ? limit : 100),
          });
        }),
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<{
            screenId?: string;
            mode?: "screen" | "region";
            region?: unknown;
            showsCursor?: boolean;
          }>(request);
          if (input.mode === "region") {
            await closeCaptureOverlays(desktop, "hide");
            await Bun.sleep(140);
          }
          try {
            const screenshot = await active().screenshots.capture(desktop, input);
            await openScreenshotPreview(
              desktop,
              (path = "/") => new URL(path, request.url),
              screenshot.id,
            );
            return json({ screenshot }, { status: 201 });
          } finally {
            if (input.mode === "region") await closeCaptureOverlays(desktop, "close");
          }
        }),
      },
      "/api/screenshots/overlay": {
        POST: api(async (request, _server, { desktop }) => {
          await jsonBody<Record<string, never>>(request);
          await openCaptureOverlays(desktop, (path = "/") => new URL(path, request.url));
          return json({ ok: true });
        }),
        DELETE: api(async (_request, _server, { desktop }) => {
          await closeCaptureOverlays(desktop, "close");
          active().screenshots.cancelSelection();
          return json({ ok: true });
        }),
      },
      "/api/screenshots/cleanup": {
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<{ maxAgeDays?: number; maxCount?: number }>(request);
          return json(await active().screenshots.cleanup(desktop, input));
        }),
      },
      "/api/screenshots/:id": {
        GET: api(async (request) =>
          json({ screenshot: active().screenshots.publicRecord(request.params.id) }),
        ),
        DELETE: api(async (request, _server, { desktop }) =>
          json(await active().screenshots.trash(desktop, request.params.id)),
        ),
      },
      "/api/screenshots/:id/content": {
        GET: api(async (request) => {
          const record = active().screenshots.get(request.params.id);
          return new Response(Bun.file(record.path), {
            headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" },
          });
        }),
      },
      "/api/screenshots/:id/action": {
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<{ action?: string }>(request);
          const record = active().screenshots.get(request.params.id);
          if (input.action === "copy") await desktop.clipboard.writeImage(record.path);
          else if (input.action === "open") await desktop.system.openPath(record.path);
          else if (input.action === "reveal") await desktop.system.revealPath(record.path);
          else if (input.action === "save-as") {
            const destination = await desktop.dialogs.saveFile({
              title: "另存截图副本",
              allowedExtensions: ["png"],
              name: `FIA-截图-${request.params.id.slice(0, 8)}.png`,
              canCreateDirectories: true,
            });
            if (destination !== null) await copyFile(record.path, destination);
            return json({ saved: destination !== null });
          } else throw new AppError("UNKNOWN_ACTION", "未知截图动作");
          return json({ ok: true });
        }),
      },
      "/api/search": {
        GET: api(async (request) => {
          const parameters = new URL(request.url).searchParams;
          const roots = parameters.getAll("root");
          return json(
            await active().search.search({
              query: parameters.get("q"),
              rootIds: roots,
              limit: Number(parameters.get("limit") ?? 80),
            }),
          );
        }),
      },
      "/api/search/recent": {
        GET: api(async () => json({ searches: active().search.recent() })),
      },
      "/api/search/action": {
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<{ token?: string; action?: string }>(request);
          const path = active().search.resultPath(requiredString(input.token, "token", 128));
          if (input.action === "open") await desktop.system.openPath(path);
          else if (input.action === "reveal") await desktop.system.revealPath(path);
          else if (input.action === "copy-path") await desktop.clipboard.writeText(path);
          else throw new AppError("UNKNOWN_ACTION", "未知搜索结果动作");
          return json({ ok: true });
        }),
      },
      "/api/files/roots": {
        GET: api(async () =>
          json({ roots: active().files.roots(), recents: active().files.recent() }),
        ),
        POST: api(async (_request, _server, { desktop }) => {
          const paths = await desktop.dialogs.openDirectory({
            title: "添加文件根目录",
            multiple: true,
          });
          const roots = [];
          for (const path of paths ?? []) roots.push(await active().files.addRoot(path));
          return json({ roots });
        }),
      },
      "/api/files/roots/:id": {
        DELETE: api(async (request) => {
          active().files.removeRoot(request.params.id);
          return json({ ok: true });
        }),
      },
      "/api/files": {
        GET: api(async (request) => {
          const parameters = new URL(request.url).searchParams;
          return json(
            await active().files.list(
              requiredString(parameters.get("root"), "root"),
              optionalString(parameters.get("relative"), "relative"),
              parameters.get("hidden") === "1",
            ),
          );
        }),
      },
      "/api/files/preview": {
        GET: api(async (request) => {
          const parameters = new URL(request.url).searchParams;
          return json(
            await active().files.preview(
              requiredString(parameters.get("root"), "root"),
              requiredString(parameters.get("relative"), "relative"),
            ),
          );
        }),
      },
      "/api/files/content/:token": {
        GET: api(
          async (request) =>
            await active().files.content(request.params.token, request.headers.get("range")),
        ),
      },
      "/api/files/actions": {
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<Record<string, unknown>>(request);
          const action = requiredString(input.action, "action", 64);
          const rootId = requiredString(input.rootId, "rootId", 128);
          const relativePath = optionalString(input.relativePath, "relativePath");
          if (action === "create-directory") {
            return json({
              relativePath: await active().files.createDirectory(
                rootId,
                optionalString(input.directoryRelativePath, "directoryRelativePath") ?? "",
                requiredString(input.name, "name", 255),
              ),
            });
          }
          if (relativePath === undefined)
            throw new AppError("INVALID_ARGUMENT", "操作缺少 relativePath");
          if (action === "rename") {
            return json({
              relativePath: await active().files.renameEntry(
                rootId,
                relativePath,
                requiredString(input.name, "name", 255),
              ),
            });
          }
          if (action === "duplicate") {
            return json({ relativePath: await active().files.duplicate(rootId, relativePath) });
          }
          if (action === "copy") {
            return json({
              relativePath: await active().files.copy(
                rootId,
                relativePath,
                optionalString(
                  input.destinationDirectoryRelativePath,
                  "destinationDirectoryRelativePath",
                ) ?? "",
              ),
            });
          }
          if (action === "move") {
            return json({
              relativePath: await active().files.move(
                rootId,
                relativePath,
                optionalString(
                  input.destinationDirectoryRelativePath,
                  "destinationDirectoryRelativePath",
                ) ?? "",
              ),
            });
          }
          if (action === "trash") {
            await active().files.trash(desktop, rootId, relativePath);
            return json({ trashed: true });
          }
          const path = await active().files.systemPath(rootId, relativePath);
          if (action === "open") await desktop.system.openPath(path);
          else if (action === "reveal") await desktop.system.revealPath(path);
          else if (action === "copy-path") await desktop.clipboard.writeText(path);
          else throw new AppError("UNKNOWN_ACTION", "未知文件动作");
          return json({ ok: true });
        }),
      },
      "/api/files/watch": {
        POST: api(async (request) => {
          const input = await jsonBody<{ rootId?: string; relativePath?: string }>(request);
          return json(
            await active().files.replaceWatch(
              requiredString(input.rootId, "rootId", 128),
              optionalString(input.relativePath, "relativePath") ?? "",
            ),
          );
        }),
        DELETE: api(async () => {
          active().files.closeWatch();
          return json({ watching: false });
        }),
      },
      "/api/capabilities": {
        GET: api(async (_request, _server, { desktop }) =>
          json(await capabilitySnapshot(desktop, active().shortcuts)),
        ),
      },
      "/api/capabilities/actions": {
        POST: api(async (request, _server, { desktop }) => {
          const input = await jsonBody<{ action?: string }>(request);
          return json({
            result: await handleCapabilityAction(
              desktop,
              (path = "/") => new URL(path, request.url),
              requiredString(input.action, "action", 64),
            ),
          });
        }),
      },
      "/api/settings": {
        GET: api(async () => json({ settings: active().repository.settings() })),
        PUT: api(async (request, _server, { desktop }) => {
          const candidate = await jsonBody<ShowcaseSettings>(request);
          const previous = active().repository.settings();
          const modifiers = ["command", "option", "control", "shift"];
          const validShortcut = (value: ShowcaseSettings["searchShortcut"]) =>
            typeof value?.key === "string" &&
            value.key.length > 0 &&
            value.key.length <= 16 &&
            Array.isArray(value.modifiers) &&
            value.modifiers.length > 0 &&
            value.modifiers.every((item) => modifiers.includes(item));
          if (
            !validShortcut(candidate.searchShortcut) ||
            !validShortcut(candidate.captureShortcut)
          ) {
            throw new AppError("INVALID_SHORTCUT", "快捷键格式无效");
          }
          if (
            !Number.isInteger(candidate.screenshotMaxAgeDays) ||
            candidate.screenshotMaxAgeDays < 1 ||
            candidate.screenshotMaxAgeDays > 365 ||
            !Number.isInteger(candidate.screenshotMaxCount) ||
            candidate.screenshotMaxCount < 1 ||
            candidate.screenshotMaxCount > 500
          ) {
            throw new AppError("INVALID_RETENTION", "保留天数需为 1–365，数量需为 1–500");
          }
          try {
            await desktop.globalShortcuts.set([
              { id: "show-search", ...candidate.searchShortcut },
              { id: "capture-region", ...candidate.captureShortcut },
            ]);
          } catch (error) {
            active().shortcuts.ready = true;
            active().shortcuts.detail = "快捷键冲突，继续使用上次成功配置";
            console.warn("应用新快捷键失败，已保留原配置", error);
            throw new AppError("SHORTCUT_CONFLICT", active().shortcuts.detail, 409);
          }
          try {
            active().repository.saveSettings(candidate);
          } catch (error) {
            console.error("快捷键已注册但设置写入失败，正在回滚", error);
            try {
              await desktop.globalShortcuts.set([
                { id: "show-search", ...previous.searchShortcut },
                { id: "capture-region", ...previous.captureShortcut },
              ]);
            } catch (rollbackError) {
              console.error("快捷键回滚失败", rollbackError);
            }
            throw new AppError("SETTINGS_SAVE_FAILED", "设置未能持久化，已保留原配置", 500);
          }
          active().shortcuts.ready = true;
          active().shortcuts.detail = "自定义快捷键已注册";
          active().events.publish({ type: "capabilities.changed" });
          return json({ settings: candidate });
        }),
      },
    },
    websocket: {
      open(socket) {
        broker.subscribe(socket);
      },
      message(socket, message) {
        if (message === "ping")
          socket.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
      },
    },
    error(error) {
      return errorResponse(error);
    },
  },
  async start({ desktop, app, server, url }) {
    await mkdir(app.dataDirectory, { recursive: true });
    const repository = new ShowcaseRepository(resolve(app.dataDirectory, "showcase.sqlite"));
    const screenshots = new ScreenshotService(app.dataDirectory, repository, (event) =>
      broker.publish(event),
    );
    await screenshots.initialize();
    const shortcuts: ShortcutState = { ready: false, detail: "尚未注册" };
    runtime = {
      repository,
      screenshots,
      search: new SpotlightSearchService(repository),
      files: new FileManagerService(repository, (event) => broker.publish(event)),
      events: broker,
      shortcuts,
      overlayIds: new Set(),
    };
    broker.attach(server);
    await desktop.tray.setMenu([
      { item: { id: "open-home", label: "打开工具箱", symbol: "square.grid.2x2" } },
      "separator",
      { item: { id: "capture-region", label: "区域截图…", symbol: "viewfinder" } },
      { item: { id: "capture-screen", label: "截取当前屏幕", symbol: "display" } },
      {
        item: {
          id: "open-screenshots",
          label: "截图历史",
          symbol: "photo.on.rectangle",
        },
      },
      "separator",
      { item: { id: "open-search", label: "搜索文件…", symbol: "magnifyingglass" } },
      { item: { id: "open-files", label: "文件管理", symbol: "folder" } },
      { item: { id: "open-capabilities", label: "能力中心", symbol: "checkmark.seal" } },
    ]);
    desktop.tray.addEventListener(
      "click",
      () => void openWindow(desktop, url, "search").catch(console.error),
    );
    desktop.tray.addEventListener(
      "menuclick",
      ({ detail }) => void statusAction(detail.id, desktop, url).catch(console.error),
    );
    desktop.dock.addEventListener(
      "reopen",
      () => void openWindow(desktop, url, "home").catch(console.error),
    );
    desktop.notifications.addEventListener(
      "click",
      () => void openWindow(desktop, url, "screenshots").catch(console.error),
    );
    await installShortcuts(desktop, url, shortcuts, repository.settings());
    await screenshots.cleanup(desktop, {
      maxAgeDays: repository.settings().screenshotMaxAgeDays,
      maxCount: repository.settings().screenshotMaxCount,
    });
  },
  async stop({ desktop }) {
    await closeCaptureOverlays(desktop, "close");
    await runtime?.screenshots.dispose();
    runtime?.files.closeWatch();
    runtime?.search.dispose();
    broker.detach();
    runtime?.repository.close();
    runtime = null;
  },
});
