# 项目结构、配置与 CLI

## 1. 阶段 1 项目结构

`fia create hello` 当前生成以下 React/Bun 项目：

```text
hello/
├── fia.config.ts
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
└── src/
    ├── server.ts
    └── ui/
        ├── index.html
        ├── main.tsx
        ├── App.tsx
        └── style.css
```

后续 `fia dev/run/build` 产生的文件统一放在 `.fia/`，正式应用产物放在 `dist/`；两者默认
加入 `.gitignore`。图标、状态栏资源和 `native/` 属于后续增量，不在首版模板中公开。

## 2. 公共配置模型（schema 2）

项目从 `@semicoder/fia/config` 导入类型安全入口：

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 2,
  app: {
    name: "My App",
    identifier: "com.example.my-app",
    version: "0.1.0",
    mode: "hybrid",
  },
  entry: "src/server.ts",
  ui: "src/ui/index.html",
  window: {
    width: 1024,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    closeBehavior: "hide",
    restoreState: true,
    alwaysOnTop: false,
    visibleOnAllSpaces: false,
    visibleOverFullScreen: false,
  },
  statusBar: {
    symbol: "circle.grid.2x2.fill",
    tooltip: "My App",
  },
});
```

只有 `configVersion`、`app.name` 和 `app.identifier` 必填。schema 2 默认值为：

- `app.version`: `0.1.0`
- `app.mode`: `dock`
- `entry`: `src/server.ts`
- `ui`: `src/ui/index.html`
- 窗口：`1024 × 700`，最小 `720 × 480`
- `window.closeBehavior`: Dock 模式为 `quit`，状态栏/混合模式为 `hide`
- `window.restoreState`: `true`
- `alwaysOnTop`、`visibleOnAllSpaces`、`visibleOverFullScreen`: `false`
- 状态栏 symbol：`circle.grid.2x2.fill`；tooltip：应用名

CLI 只读取当前目录的 `fia.config.ts`。配置必须默认导出普通对象，未知字段在每一层都报错；
bundle identifier 使用 reverse-DNS 格式，版本使用数字 `X.Y.Z`。应用名必须可安全用作 `.app`
目录名。服务入口与 UI HTML 必须是配置目录内的相对路径并指向可读文件。配置版本不兼容时
MVP 直接失败，不自动迁移。

公共 `configVersion` 与应用包内 `fia-config.json.schemaVersion` 是不同边界。阶段 2 CLI
只接受公共 schema 2，旧项目需要显式迁移；Host 内部 schema 3 承载桌面字段，同时继续读取
历史内部 schema 1/2。三种置顶/Spaces 行为相互独立，不做隐式绑定。

## 3. `fia create`

```bash
fia create hello
fia create hello --no-install
fia create hello --git
```

名称必须是单段小写 kebab-case。CLI 在当前目录生成同名项目，将 `hello-world` 转换为显示名
`Hello World` 和占位 bundle identifier `com.example.hello-world`。已有目标一律拒绝，不提供
覆盖选项。

生成过程在目标旁的临时目录完成。默认先写入模板并运行 `bun install`；`--git` 额外执行
`git init`。所有步骤成功后才原子移动到目标位置，失败会清理临时目录。`--no-install`
用于离线、测试或当前仓库内尚未发布 `@semicoder/fia` 的开发场景。

## 4. React 模板与托管 Runtime

模板使用 React 19 和 Bun 1.3.14 full-stack HTML route：

- `/` 提供 React 页面与 HMR 资源。
- `/api/hello` 展示普通 HTTP JSON 请求。
- `/ws` 展示应用级 WebSocket Echo。
- `bun run dev` 组装临时 Host 应用并通过 Bun HMR 更新 UI 和服务路由。
- `bun run run` 使用生产协议运行当前源码，不修改 `dist/`。
- `bun run build` 输出 ad-hoc 签名的 arm64 `.app`。
- `bun run typecheck` 执行严格 TypeScript 检查。

`src/server.ts` 默认导出 `defineApp({ routes, fetch, websocket })`。FIA 独占 `Bun.serve`、
监听地址、随机端口、`/__fia/*`、bootstrap/session/control token 和 stdin/stdout 生命周期；
旧式直接 `Bun.serve` 入口会得到迁移错误。普通 HTTP 和应用 WebSocket 仍由项目代码定义。

模板 UI 还从 `@semicoder/fia/native` 导入类型化桌面 API，展示当前 Dock/状态栏模式并切换
状态栏与窗口浮动级别。该模块在普通浏览器中返回 `isAvailable() === false`，不会伪造原生能力。

## 5. CLI 构建闭环

阶段 1 已实现：

- `fia dev`：组装临时 `.app`，由 Host 启动带 HMR 的 FIA Runtime 并聚合日志。
- `fia run`：从当前源码构建临时生产 `.app` 并使用生产启动协议运行，不修改 `dist/`。
- `fia build`：编译 runtime、校验内嵌预编译 Host、组装、ad-hoc 签名并严格验证 `.app`。

`fia build` 在 `.fia/build/<build-id>/` staging 中完成全部工作，验证通过后原子替换
`dist/<app.name>.app`。`fia run` 使用 `.fia/run/` 临时产物，`fia dev` 使用 `.fia/dev/`
临时 Host 和外部 Bun 入口；两者退出后清理本次 staging。

目标进程所有权保持不变：生产和 FIA 开发模式均由 Swift Host 拥有 Bun runtime，CLI 退出
后通过 Host 生命周期链路回收 runtime，不允许残留后台进程。
