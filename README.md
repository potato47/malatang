# FIA Framework

FIA 是一个面向 macOS 的常驻 Bun 服务容器。应用由一个 Swift/AppKit 状态栏宿主和一个
自包含 Bun Backend 组成：浏览器或原生 WebView 使用标准 HTTP/WebSocket 访问 Backend，
Backend 再通过严格的 JSONL stdio 协议调用原生能力。

## 要求

- macOS 14+
- Apple Silicon arm64
- Bun 1.3.14+（仅开发、构建时需要）

生产 `.app` 内的 Backend 是 standalone Mach-O，不依赖用户安装 Bun。

## 快速开始

```bash
bun run fia -- create hello --no-install
cd hello
bun install
bun run dev
```

配置使用严格的 `configVersion: 4`：

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 4,
  app: {
    name: "Hello",
    identifier: "com.example.hello",
    version: "0.1.0",
    icon: "assets/icon.icns",
  },
  backend: { entry: "src/backend.ts", watch: ["src"] },
  statusBar: { symbol: "bolt.fill", tooltip: "Hello" },
});
```

Backend 直接声明 Bun HTTP/WS handlers，并在启动钩子中使用 Host API：

```ts
import { defineBackend } from "@semicoder/fia/backend";
import page from "./ui/index.html";

export default defineBackend()({
  http: {
    publicRoutes: { "/": page },
    routes: {
      "/api/items/:id": {
        GET: (request, _server, { app }) =>
          Response.json({ id: request.params.id, dataDirectory: app.dataDirectory }),
      },
    },
  },
  async start({ host, url }) {
    await host.statusItem.setMenu([{ type: "item", id: "open", title: "Open" }]);
    host.statusItem.onAction(({ id }) => {
      if (id === "open") void host.webviews.open({ id: "main", url: url("/").href });
    });
  },
});
```

在 `start` 中通过 Host API 注册的事件监听器会随当前 Backend 生命周期自动清理，热重载和退出时
不需要手动保存注销函数。

受保护 route 与 fallback `fetch` 的第三参数提供 `host` 和只读 `app` 信息，其中
`app.dataDirectory` 是 Host 按应用 identifier 创建的绝对持久化目录。

Host API 还提供显式授权的系统通知、打开/保存文件面板、文本剪贴板和按 bundle identifier
隔离的 Keychain。所有 Promise 方法都接受可选的 `{ signal }` 尾参数；取消文件面板会同时关闭
原生面板。

WebView 支持原生窗口和完全无边框窗口。无边框模式可配置透明背景、阴影、用户缩放、顶部
原生拖动带及主屏左上坐标，适合搜索框、HUD 和截图遮罩等浮层。

网页不导入 FIA 包，只使用 `fetch`、WebSocket 和普通 URL。原生 API 仅存在于 Backend。

## 开发与构建

```bash
bun run fia -- doctor
bun run fia -- dev
bun run fia -- run
bun run fia -- build
bun run check
```

- `dev`：临时状态栏 App + Bun full-stack HMR。
- `dev --print-session-url --emit-action <id>`：输出一次性开发会话并模拟一次状态栏菜单 action。
- `run`：构建临时生产 App 并启动。
- `build`：生成并 ad-hoc 签名 `dist/<App>.app`。

生产布局：

```text
Contents/MacOS/FIAHost
Contents/Helpers/FIABackend
Contents/Resources/fia-config.json
```

详细边界见[框架文档](./docs/framework/README.md)。
