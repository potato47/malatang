# @semicoder/fia

FIA 的 CLI、配置类型和 Bun Backend runtime。Swift 状态栏 Host 启动唯一的常驻 Backend；
Backend 通过 stdio 调用原生能力，并向浏览器/WebView 提供普通 HTTP 与 WebSocket。

## 公共导出

- `@semicoder/fia/config`：`configVersion: 6` 配置类型与 `defineConfig`。
- `@semicoder/fia/backend`：Bun-only `defineBackend`、HTTP/WS runtime 和类型化 Desktop API。

不存在浏览器 FIA runtime、Native bridge 或 MCP 导出。

`fia.config.ts` 可用证书的完整名称配置稳定签名；仅接受 `Apple Development:` 或
`Developer ID Application:` identity，且必须精确匹配
`security find-identity -v -p codesigning` 的输出。省略时 FIA 会提示并使用 ad-hoc 签名：

```ts
export default defineConfig({
  // ...
  signing: { identity: "Apple Development: Example (TEAMID)" },
  release: {
    identity: "Developer ID Application: Example (TEAMID)",
    notarization: { keychainProfile: "fia-notary" },
  },
});
```

`configVersion: 6` 可以组合项目自有的 Swift Host 和 CLI helper：

```ts
export default defineConfig({
  // ...
  host: { executable: "native/.build/release/AIXHost", name: "AIXHost" },
  helpers: [{ executable: "native/.build/release/aix", name: "aix" }],
});
```

路径必须相对 `fia.config.ts`、留在项目目录内，并指向可读、可执行的 arm64 Mach-O。
名称只允许安全的 bundle 文件名；helper 名称不可重复，`FIABackend` 由 FIA 保留。

FIA 按 Backend、按名称排序的 helpers、Host、顶层 App 的顺序 inside-out 签名并逐项验证。
`fia package` 使用 `release.identity` 生成启用 Hardened Runtime 与安全时间戳的 arm64
预公证 ZIP 和 `.sha256`，该产物不作为最终公开发布包。`fia release` 还会通过 `notarytool`
提交公证、staple ticket 并执行 Gatekeeper 验证。公证密码或 API key 不写入配置；先使用
`xcrun notarytool store-credentials fia-notary` 保存到钥匙串。

```ts
import { defineBackend } from "@semicoder/fia/backend";

export default defineBackend()({
  http: {
    routes: {
      "/api/items/:id": {
        GET: (request, _server, { desktop, app }) => {
          void desktop.clipboard.writeText(request.params.id);
          return Response.json({ id: request.params.id, dataDirectory: app.dataDirectory });
        },
      },
    },
  },
  async start({ desktop, url }) {
    const main = await desktop.windows.create({ id: "main", url: url("/") });
    desktop.tray.addEventListener("click", () => void main.show());
  },
});
```

`publicRoutes` 明确承载公开 HTML/静态资源；`routes`、`fetch` 与 WebSocket upgrade 默认要求
FIA 会话。应用页面由 Host 安全打开时会自动建立 HttpOnly 会话，前端无需处理令牌。
route 和 fallback `fetch` 的第三参数提供当前 `desktop` 与 Host 权威的 `app` 元信息；
`app.dataDirectory` 已创建且不依赖 Backend 的工作目录。
需要跨模块保存 server 类型时可使用带默认参数的 `BackendServer<WebSocketData = unknown>`，无需直接
书写缺少默认泛型的 `Bun.Server`。
全局快捷键、屏幕截图、通知、文件面板、剪贴板和 Keychain 也只存在于 Backend：

```ts
const status = await desktop.notifications.requestAuthorization();
if (status === "authorized") {
  await desktop.notifications.send({ title: "FIA is ready" });
}
const files = await desktop.dialogs.openFile({ allowedExtensions: ["json"], multiple: true });
await desktop.clipboard.writeText(files?.join("\n") ?? "");
await desktop.keychain.set("api-token", "secret");
```

截图返回由 FIA 管理的临时 `CapturedImage`。PNG 保存在 Application Support 中，stdio 只传递
文件元数据；`file`/`stream()` 按需读取图片，不受 1 MiB 帧限制：

```ts
async start({ desktop }) {
  const screen = (await desktop.screens.list()).find((item) => item.containsPointer);
  if (screen !== undefined) {
    const capture = await desktop.screenCapture.capture({
      screenId: screen.id,
    });
    try {
      await desktop.clipboard.writeImage(capture);
      // await capture.saveTo("/absolute/persistent/capture.png");
    } finally {
      await capture.dispose();
    }
  }
}
```

`CapturedImage` 提供 `type`、`size`、像素尺寸、`file`、`stream()`、`arrayBuffer()`、`saveTo()`
和幂等 `dispose()`。应用应在持久化、复制或读取完成后释放；热重载和 Backend 停止也会清理当前
Desktop session 尚未释放的截图。一个 session 最多保留 128 个、合计 512 MiB 的未释放截图。
HTTP handler 可用 `capture.stream({ dispose: true })` 构造 `Response`，流读取完成、失败或取消
时会自动释放临时文件。

需要保留 macOS 原生红黄绿按钮，同时让页面绘制到标题栏区域时，使用 `overlay`：

```ts
const main = await desktop.windows.create({
  id: "main",
  url: url("/"),
  title: "Main",
  width: 1024,
  height: 700,
  style: "overlay",
  dragRegion: { height: 52, leftInset: 88, rightInset: 24 },
});
```

FIA 隐藏原生标题文字和标题栏背景，但不会移动系统按钮，也不会向页面注入安全区或 CSS 变量。
页面需要为左上角按钮预留视觉空间，并避免把可点击控件放进 `dragRegion`。Host 会从拖动命中区
自动排除红黄绿按钮。

搜索框、截图遮罩等浮层可以创建完全无边框的 WebView：

```ts
const launcher = await desktop.windows.create({
  id: "launcher",
  url: url("/launcher"),
  width: 640,
  height: 360,
  x: 120,
  y: 80,
  restoreFrame: false,
  style: "frameless",
  transparent: true,
  shadow: true,
  resizable: false,
  dragRegion: { height: 32, leftInset: 12, rightInset: 48 },
  alwaysOnTop: true,
});
```

`x/y` 是以主屏左上角为原点的逻辑点坐标；窗口状态的 `frame` 返回实际外框。无边框窗口的
透明页面背景和圆角由 CSS 绘制，拖动带覆盖范围不接收网页左键交互。窗口样式可选
`native`、`overlay` 或 `frameless`，默认为 `native`。窗口外观字段只能在首次 `create` 时确定，
同 ID 接管时不能切换。

所有 Promise 方法都接受可选的 `{ signal: AbortSignal }` 尾参数。文件面板和通知授权没有固定
超时；AbortSignal 会取消等待，文件面板也会被关闭。

窗口创建后可使用 `launcher.minimize()`、`maximize()`、`restore()` 和
`setFullScreen(boolean)` 控制原生状态，并从同步只读的 `launcher.state` 读取
`minimized`、`maximized`、`fullScreen`。`refresh()` 可主动刷新状态，`restore` 不负责退出全屏。

通过 `desktop.dock`、`desktop.tray`、`desktop.globalShortcuts`、窗口 handle 和
`desktop.notifications` 的 `addEventListener` 注册的监听器属于当前 `start` 生命周期，
FIA 会在热重载或 Backend 停止时自动注销；全局快捷键集合
也会随 definition 生命周期清空。`stop` 只需清理应用自行创建的定时器、连接等资源。
旧 definition 的 Desktop session 和窗口 handle 在 `stop` 返回后失效；新 definition 可用相同
窗口 ID 接管 Host 中仍存在的窗口。

开发 E2E 可组合使用 `fia dev --print-session-url --emit-action <menu-id>`。前者输出一个 30 秒、
单次消费的会话链接，后者在首次 ready 后通过真实 Host 事件链路触发菜单 action。
