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

应用开发不需要 Swift 编译器或 Xcode 工程。`fia dev` 自动启动窗口、Bun 和 Vite；前端使用 HMR，后端变更执行受控进程重启。从 FIA 0.17.0 开始，每个窗口标题栏最右侧默认提供“在浏览器中打开”，覆盖开发、预览和正式构建，默认模板自动具备入口。可用 `fia agent open --browser` 或正式应用 CLI 的 `open --browser`；显式 `--url` 才输出单次授权链接。浏览器与原生共享后端数据，菜单可撤销所有浏览器会话。已有应用升级此能力需重新构建并分发完整安装包；安全与权限契约见 [框架文档](docs/framework/README.md#完整浏览器界面0170)。

从 FIA 0.18.0 开始，原生标题栏在浏览器入口左侧提供置顶图标，点击切换当前窗口置顶，选中时填充高亮。加载和后端重连期间仍可使用；状态保留至窗口真正关闭或应用退出。默认创建的项目自动具备按钮，已有应用需重新分发完整安装包。

本地开发显示 `<name> Dev`、黄色 `DEV` Dock 标记及菜单栏标记，macOS Bundle ID 追加 `.dev`。`fia run` 提供不带 HMR 的隔离打包预览：`<name> Preview`、蓝色 `PREV` 标记及 `.preview` Bundle ID。开发数据保留在 `.fia/dev/data`，预览数据在 `.fia/preview/data`，可与正式安装版同时运行；直接打开预览包也保留隔离。`fia agent --preview` 控制预览版。两种本地模式都禁用正式更新源，具体身份、凭据兼容及数据边界见[框架契约](docs/framework/README.md#本地开发与打包预览)。

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

`fia build` 生成本机 `.app`；`fia build --dmg` 另生成包含应用和 Applications 快捷方式的测试 DMG，并挂载验证启动和退出。`fia release` 使用 Developer ID Application 签名应用及 DMG，对 DMG 公证、staple、验证 Gatekeeper 并检查镜像内应用，输出 `.dmg`、SHA-256 和检查报告；不需要 Developer ID Installer。`fia release --update` 生成 Ed25519 签名的前后端代码更新，上传普通 HTTPS 静态托管即可。代码更新须用户确认；失败回退上一版代码，用户数据不随代码回退。

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

GitHub 自动发布：先执行 `bun run version:npm <version>` 同步版本，提交后推送 `v<version>` 标签；Actions 会构建 Apple Silicon 运行时、执行检查、校验 npm 归档，并用 OIDC 发布 `@semicoder/fia`。正式版本进入 `latest`，预发布版本进入 `next`；手动运行 workflow 只验证和上传归档。首次配置与完整步骤见 [npm 自动发布](docs/npm-release.md)。

本地交互式发布仍可使用 `bun run release`，默认递增 minor 版本并将 patch 归零；也可指定更高版本。命令自动同步版本、构建、检查并发布。使用 `bun run release --dry-run` 模拟完整流程，结束或失败后恢复版本文件。正式发布要求开始时工作区干净，成功后保留版本变更供提交。本地命令对 `registry.npmjs.org` 绕过代理，单次请求超时为 15 分钟，关闭自动重试，并显示 HTTP 请求日志。同一版本只选择一种发布方式，不要在本地发布后再推送同版本发布标签。

此仓库不再提供 Swift 应用工程、Native/Hybrid 模板或 Sparkle 更新。

## 应用自定义 CLI 子命令

在 `fia.config.ts` 的 `agent.commands` 中声明子命令，例如 `commands: { plugin: { description: "Develop plugins", entry: "cli/plugin.ts" } }`。命令名不能覆盖 help、call、exec 等框架内置命令。入口默认导出接收 `FIACommandContext`（从 `@semicoder/fia/config` 导入类型）的函数，返回 `void` 或 0–255 退出码。

上下文包含 `args`、调用者 `cwd` 和 `assetsDirectory`（开发项目根目录；生产生效代码的 backend 资产目录）。入口会被编译进签名代码产物，通过 `应用命令 plugin ...` 或 `fia agent plugin ...` 调用；help 与生成的 skill 自动列出它。命令跟随当前生效版本，沿用实例连接、后台启动、脚本租约和进程组清理，不创建另一套 CLI。自定义命令不设执行超时，Ctrl-C/应用断开会终止；运行期间阻止应用更新。stdout/stderr 和退出码原样传递，参数以数组传递。

自定义命令可要求自己的开发依赖；框架不会隐式安装依赖或执行包安装脚本。应用应在命令帮助中注明要求。变更通用 CLI 会改变 runtime ID，既有应用须通过完整安装包取得新运行时。

带自定义命令的开发应用在后端脚本或其项目依赖变化时重新构建，避免命令继续使用旧 bundle。原生 Keychain/对话框交互期间，监督层与外层启动流程共用就绪判定；开发 CLI 同样暂停等待计时，交互结束后恢复超时约束。

## 框架与首个应用共同开发（未发布）

FIA 活跃源码现位于麻辣烫仓库的 `framework/fia/`，保留独立 API、模板、测试与打包边界；麻辣烫稳定后再拆回独立仓库。公开 npm 0.18.0 不包含本次联调工具。普通消费已发布 npm 包的应用仍不需要 Swift；维护共仓源码需要 Bun 1.4.2 和 Swift 6 工具链。框架维护流程见 [共同开发](docs/co-development.md)。

开发 CLI 新增可重复的 `fia dev --watch-ignore <相对目录>`，按目录边界排除指定子树，不影响相似前缀的其他目录。该参数仅供外层工具已经负责构建/重启的目录；默认生成应用无需设置。嵌套的 node_modules、.git、.fia、.build、dist 也不会触发后端重载。
