# FIA 4

用一套 TypeScript API 构建同时面向人类和 agent 的 macOS 14+、Apple Silicon 应用。框架提供桌面 UI、应用 CLI、TypeScript 脚本 SDK 和随应用更新的 skill。默认 React + Vite 前端和 Bun 后端，预编译 Swift 宿主提供原生窗口和系统能力。

```text
桌面 UI → HTTP / 事件流 ─┐
CLI / TypeScript → Unix Socket ─┴→ 共享 Bun API → Swift Host
```

```bash
bunx @semicoder/fia create my-app
cd my-app
bun run dev
```

应用开发不需要 Swift 编译器或 Xcode 工程。`fia dev` 自动启动窗口、Bun 和 Vite；前端使用 HMR，后端变更执行受控进程重启。

项目入口：

- `fia.config.ts`：应用信息、系统权限说明、签名和更新设置。
- `shared/api.ts`：方法、事件、Zod 输入输出、说明和示例的唯一契约。
- `backend/index.ts`：共享 API 实现、业务逻辑和原生窗口控制，可补充 HTTP/WebSocket。
- `frontend/`：React 页面，通过带类型的客户端调用共享 API。
- `agent/instructions.md`：应用补充的业务流程，与生成的 skill 一起发布。

```ts
// backend/index.ts
import { defineBackend, implementAPI } from "@semicoder/fia/backend";
import api from "../shared/api";

export default defineBackend({
  api: implementAPI(api, {
    "counter.get": () => ({ value: 0 }),
    "counter.increment": ({ by }) => ({ value: by }),
  }),
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
import { createClient, native } from "@semicoder/fia/client";
import type api from "../shared/api";

const app = createClient<typeof api>();
const counter = await app.call("counter.get", {});
await native.clipboard.writeText({ text: "Hello" });
```

默认模板包含完整的持久化共享计数器。开发时在另一终端执行 `bun run agent call counter.increment --json '{"by":1}'`，桌面立即收到同一事件。

安装应用后，从应用菜单或 tray 选择安装 CLI，再运行：

```bash
my-app call counter.get --json '{}'
my-app exec -e 'console.log(await app.call("counter.increment", {by: 1}))'
my-app skill install --dir ~/.agents/skills
my-app open
```

应用自带 Bun，不依赖系统 Node/Bun。CLI 冷启动不弹窗、不抢焦点，tray 可显示或退出应用。`windows.create` 声明窗口，`open/focus` 显示；后端重启保留窗口状态。脚本是可信本机代码，独立进程提供取消与超时，不是安全沙箱。长期任务由应用 API 管理。

`fia build` 生成本机 `.app`。`fia release` 使用 Developer ID 签名和公证生成安装包；`fia release --update` 生成 Ed25519 签名的前后端代码更新，上传普通 HTTPS 静态托管即可。代码更新须用户确认；失败回退上一版代码，用户数据不随代码回退。

详见 [框架契约](docs/framework/README.md)、[CLI 与发布](packages/cli/README.md)、[从 FIA 3 迁移](docs/framework/migration-v4.md)。

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

发布只需 `bun run release`，默认递增 minor 版本并将 patch 归零（例如 `0.14.0` → `0.15.0`）；也可用 `bun run release 0.16.0` 指定更高版本。命令自动同步版本、构建、检查并发布，无需单独执行 version 命令。使用 `bun run release --dry-run` 或 `bun run release 0.16.0 --dry-run` 模拟完整流程，结束后恢复版本文件；失败时也会恢复版本文件。正式发布要求开始时工作区干净，成功后保留版本变更供提交。模拟和正式发布均对 `registry.npmjs.org` 绕过代理，单次请求超时为 15 分钟，关闭自动重试，并显示 HTTP 请求日志。

此仓库不再提供 Swift 应用工程、Native/Hybrid 模板或 Sparkle 更新。
