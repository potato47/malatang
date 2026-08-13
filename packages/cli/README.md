# @semicoder/fia

FIA 的 CLI、配置类型和 Bun Backend runtime。Swift 状态栏 Host 启动唯一的常驻 Backend；
Backend 通过 stdio 调用原生能力，并向浏览器/WebView 提供普通 HTTP 与 WebSocket。

## 公共导出

- `@semicoder/fia/config`：`configVersion: 5` 配置类型与 `defineConfig`。
- `@semicoder/fia/backend`：Bun-only `defineBackend`、HTTP/WS runtime 和类型化 Host API。

不存在浏览器 FIA runtime、Native bridge 或 MCP 导出。

`fia.config.ts` 可用证书的完整名称配置稳定签名；仅接受 `Apple Development:` 或
`Developer ID Application:` identity，且必须精确匹配
`security find-identity -v -p codesigning` 的输出。省略时 FIA 会提示并使用 ad-hoc 签名：

```ts
export default defineConfig({
  // ...
  signing: { identity: "Apple Development: Example (TEAMID)" },
});
```

```ts
import { defineBackend } from "@semicoder/fia/backend";

export default defineBackend()({
  http: {
    routes: {
      "/api/items/:id": {
        GET: (request, _server, { host, app }) => {
          void host.clipboard.writeText(request.params.id);
          return Response.json({ id: request.params.id, dataDirectory: app.dataDirectory });
        },
      },
    },
  },
  async start({ host, url }) {
    host.statusItem.onClick(() => {
      void host.webviews.open({ id: "main", url: url("/").href });
    });
  },
});
```

`publicRoutes` 明确承载公开 HTML/静态资源；`routes`、`fetch` 与 WebSocket upgrade 默认要求
FIA 会话。应用页面由 Host 安全打开时会自动建立 HttpOnly 会话，前端无需处理令牌。
route 和 fallback `fetch` 的第三参数提供当前 `host` 与 Host 权威的 `app` 元信息；
`app.dataDirectory` 已创建且不依赖 Backend 的工作目录。
需要跨模块保存 server 类型时可使用带默认参数的 `FIAServer<WebSocketData = unknown>`，无需直接
书写缺少默认泛型的 `Bun.Server`。
全局快捷键、屏幕截图、通知、文件面板、剪贴板和 Keychain 也只存在于 Backend：

```ts
const status = await host.notifications.requestAuthorization();
if (status === "authorized") {
  await host.notifications.send({ title: "FIA is ready" });
}
const files = await host.dialogs.openFile({ allowedExtensions: ["json"], multiple: true });
await host.clipboard.writeText(files?.join("\n") ?? "");
await host.keychain.set("api-token", "secret");
```

截图结果以 Application Support 中的 PNG 路径返回，不通过 stdio 传输图片数据：

```ts
async start({ host, app }) {
  const screen = (await host.screens.list()).find((item) => item.containsPointer);
  if (screen !== undefined) {
    const capture = await host.screenCapture.capture({
      screenId: screen.id,
      destination: `${app.dataDirectory}/capture.png`,
    });
    await host.clipboard.writeImage(capture.path);
  }
}
```

搜索框、截图遮罩等浮层可以创建完全无边框的 WebView：

```ts
await host.webviews.open({
  id: "launcher",
  url: url("/launcher").href,
  width: 640,
  height: 360,
  x: 120,
  y: 80,
  restoreFrame: false,
  windowStyle: "borderless",
  transparent: true,
  shadow: true,
  resizable: false,
  dragRegion: { height: 32, leftInset: 12, rightInset: 48 },
  alwaysOnTop: true,
});
```

`x/y` 是以主屏左上角为原点的逻辑点坐标；窗口状态的 `frame` 返回实际外框。无边框窗口的
透明页面背景和圆角由 CSS 绘制，拖动带覆盖范围不接收网页左键交互。窗口外观字段只能在首次
`open` 时确定，同 ID upsert 时不能切换。

所有 Promise 方法都接受可选的 `{ signal: AbortSignal }` 尾参数。文件面板和通知授权没有固定
超时；AbortSignal 会取消等待，文件面板也会被关闭。

通过 `host.application.onReopen`、`host.statusItem.onClick`、`host.statusItem.onAction`、
`host.globalShortcuts.onPressed`、`host.webviews.onEvent` 和 `host.notifications.onClick` 注册的
监听器属于当前 `start` 生命周期，FIA 会在热重载或 Backend 停止时自动注销；全局快捷键集合
也会随 definition 生命周期清空。`stop` 只需清理应用自行创建的定时器、连接等资源。
如果资源保存在模块级变量中，关闭后也要把该引用清空，避免热重载取得已关闭的 handle。

开发 E2E 可组合使用 `fia dev --print-session-url --emit-action <menu-id>`。前者输出一个 30 秒、
单次消费的会话链接，后者在首次 ready 后通过真实 Host 事件链路触发菜单 action。
