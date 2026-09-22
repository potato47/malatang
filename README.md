# FIA 3

用 TypeScript 构建 macOS 14+、Apple Silicon 桌面应用。默认 React + Vite 前端和 Bun 后端，预编译 Swift 宿主提供原生窗口和系统能力。

```text
WKWebView / React → HTTP、WebSocket → Bun → stdio → Swift Host
```

```bash
bunx @semicoder/fia create my-app
cd my-app
bun run dev
```

应用开发不需要 Swift 编译器或 Xcode 工程。`fia dev` 自动启动窗口、Bun 和 Vite；前端使用 HMR，后端变更执行受控进程重启。

项目只有三个入口：

- `fia.config.ts`：应用信息、系统权限说明、签名和更新设置。
- `backend/index.ts`：HTTP/WebSocket、业务逻辑和原生窗口控制。
- `frontend/`：React 页面，通过 `/api` 或原生 TS SDK 访问能力。

```ts
// backend/index.ts
import { defineBackend } from "@semicoder/fia/backend";

export default defineBackend({
  http: {
    routes: {
      "/hello": { GET: () => Response.json({ message: "Hello" }) },
    },
  },
  async start({ native }) {
    await native.windows.setTitlebar({
      id: "main",
      items: [
        { type: "text", id: "status", label: "Ready" },
        { type: "button", id: "save", label: "Save", symbol: "square.and.arrow.down" },
      ],
    });
    native.on("windows.titlebarAction", (event) => console.log(event));
  },
});
```

```ts
// frontend
import { native } from "@semicoder/fia/client";

const response = await fetch("/api/hello");
await native.clipboard.writeText({ text: "Hello" });
```

窗口统一使用系统标题栏和下方 WebView，支持多窗口和 TS 声明的原生标题栏按钮、文字、间隔。窗口由宿主持有，后端重启时保留。

`fia build` 生成本机 `.app`。`fia release` 使用 Developer ID 签名和公证生成安装包；`fia release --update` 生成 Ed25519 签名的前后端代码更新，上传普通 HTTPS 静态托管即可。代码更新须用户确认；失败回退上一版代码，用户数据不随代码回退。

详见 [框架契约](docs/framework/README.md)、[CLI 与发布](packages/cli/README.md)、[从 FIA 2 迁移](docs/framework/migration-v3.md)。

## 框架开发

只有维护 FIA 原生宿主的人需要 Swift 工具链：

```bash
bun install
bun run runtime:build  # 使用固定版本 Bun 1.4.2，生成 Host、Bun 和校验清单
bun run cli:build
bun run check
bun run smoke
```

预编译产物生成在 `packages/cli/assets/darwin-arm64/`，由 npm 包携带，不纳入源码仓库。应用构建找不到匹配产物时直接报错，不自动编译 Swift。

`fia create playground --local` 使用当前包目录的本地依赖；修改框架 TS 后重新构建 CLI，修改 Swift 后重新运行 `runtime:build`。应用侧仍使用预编译产物。

发布使用 `bun run release:npm --dry-run` 检查分发内容，使用 `bun run release:npm` 正式发布；正式发布要求干净工作区。模拟和正式发布均对 `registry.npmjs.org` 绕过代理，单次请求超时为 15 分钟，关闭自动重试，并显示 HTTP 请求日志。

此仓库不再提供 Swift 应用工程、Native/Hybrid 模板或 Sparkle 更新。
