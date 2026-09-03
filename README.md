# FIA Framework

FIA 是一个面向 macOS 的常驻 Bun 服务容器。应用由一个 Swift/AppKit 状态栏宿主和一个
自包含 Bun Backend 组成：浏览器或原生 WebView 使用标准 HTTP/WebSocket 访问 Backend，
Backend 再通过严格的 JSONL stdio 协议调用原生能力。

## 要求

- macOS 14+
- Apple Silicon arm64
- Bun 1.4.0+（仅开发、构建时需要）

生产 `.app` 内的 Backend 是 standalone Mach-O，不依赖用户安装 Bun。

## 快速开始

```bash
bun run fia -- create hello --no-install
cd hello
bun install
bun run dev
```

配置使用严格的 `configVersion: 6`：

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 6,
  app: {
    name: "Hello",
    identifier: "com.example.hello",
    version: "0.1.0",
    icon: "assets/icon.icns",
  },
  backend: { entry: "backend/index.ts", watch: ["backend", "frontend"] },
  // 可选：使用项目内已构建的 arm64 Mach-O 自定义 Host 和 CLI helper。
  // host: { executable: "native/.build/release/HelloHost", name: "HelloHost" },
  // helpers: [{ executable: "native/.build/release/hello", name: "hello" }],
  statusBar: { symbol: "bolt.fill", tooltip: "Hello" },
  // 可选：为需要稳定隐私授权的开发构建指定本机签名 identity。
  // signing: { identity: "Apple Development: Example (TEAMID)" },
  // 可选：为 FIA package/release 指定发布 identity 与钥匙串公证 profile。
  // release: {
  //   identity: "Developer ID Application: Example (TEAMID)",
  //   notarization: { keychainProfile: "fia-notary" },
  // },
});
```

Backend 直接声明 Bun HTTP/WS handlers，并在启动钩子中使用 Desktop API：

```ts
import { defineBackend } from "@semicoder/fia/backend";
import page from "../frontend/index.html";

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
  async start({ desktop, url }) {
    const main = await desktop.windows.create({ id: "main", url: url("/"), title: "My App" });
    await desktop.tray.setMenu([
      { item: { id: "open", label: "Open", accelerator: "CmdOrCtrl+O" } },
      "separator",
    ]);
    desktop.tray.addEventListener("menuclick", ({ detail }) => {
      if (detail.id === "open") void main.show();
    });
  },
});
```

在 `start` 中通过 Desktop API 注册的事件监听器会随当前 Backend 生命周期自动清理，热重载和退出时
不需要手动保存注销函数。

受保护 route 与 fallback `fetch` 的第三参数提供 `desktop` 和只读 `app` 信息，其中
`app.dataDirectory` 是 Host 按应用 identifier 创建的绝对持久化目录。

Desktop API 还提供全局快捷键、屏幕枚举与截图、系统通知、文件与目录操作、打开/保存文件面板、
文本/PNG 剪贴板和按 bundle identifier 隔离的 Keychain。所有 Promise 方法都接受可选的
`{ signal }` 尾参数；取消文件面板会同时关闭原生面板。

BrowserWindow 通过 `style: "native" | "overlay" | "frameless"` 支持标准原生标题栏、保留系统
红黄绿按钮且由 WebView 覆盖标题栏的沉浸模式，以及完全无边框窗口。沉浸和无边框模式可以配置
顶部原生拖动带；无边框模式还支持透明背景。窗口打开后支持最小化、最大化/恢复、全屏切换，
并通过 `change`/`close` 事件报告变化。

网页不导入 FIA 包，只使用 `fetch`、WebSocket 和普通 URL。原生 API 仅存在于 Backend。
默认项目仅提供基础 React + Tailwind CSS 前端骨架，不包含 FIA 组件库或设计系统；应用可以自行选择
前端框架和组件方案，FIA 只维护桌面宿主、Backend 生命周期与原生能力。

## 开发与构建

```bash
bun run fia -- doctor
bun run fia -- dev
bun run fia -- run
bun run fia -- build
bun run fia -- package
bun run fia -- release
bun run check
```

- `dev`：临时状态栏 App + Bun full-stack HMR。
- `dev --print-session-url --emit-action <id>`：输出一次性开发会话并模拟一次状态栏菜单 action。
- `run`：构建临时生产 App 并启动。
- `build`：生成 `dist/<App>.app`；配置 `signing.identity` 时使用该 identity 签名，缺省使用
  ad-hoc 签名。
- `package`：使用 `release.identity`、Hardened Runtime 和安全时间戳生成待验证/公证的
  Developer ID 签名 ZIP；该产物不是最终公开发布包。
- `release`：提交公证、staple ticket、执行 Gatekeeper 验证，并生成最终 ZIP 与 SHA-256 文件。

发布前先将公证凭据保存到登录钥匙串（交互式输入 App 专用密码）：

```bash
xcrun notarytool store-credentials "fia-notary" \
  --apple-id "you@example.com" \
  --team-id "TEAMID"
```

生产布局：

```text
Contents/MacOS/FIAHost
Contents/Helpers/FIABackend
Contents/Resources/fia-config.json
```

配置 custom Host/helper 时，`FIAHost` 替换为 `host.name`，额外 helper 位于
`Contents/Helpers/<helper.name>`。这些输入必须是项目目录内可读、可执行且仅包含 arm64 的 Mach-O；
`FIABackend` 名称由 FIA 保留。

详细边界见[框架文档](./docs/framework/README.md)。框架的端到端能力在独立的实际项目中验证，
本仓库不维护默认示例应用。
