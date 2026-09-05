# FIA 2.0

FIA 是 Swift-first、可组合的 macOS 14+ GUI 框架。每个应用拥有可编辑的 Swift executable；
Web、Bun Backend、状态栏和 Sparkle 更新均按需启用。

```text
Application Swift Target
        │
        ▼
     FIA Runtime
        ├── WindowManager (SwiftUI / AppKit / WKWebView)
        ├── Native RPC + NativeResource
        ├── optional BunSupervisor
        └── optional Sparkle UpdateManager
```

## 快速开始

```bash
bun install
bun run fia -- create hello
cd hello
bun run dev
```

默认模板是 React + Vite + TypeScript Web 主窗口，不包含 Bun Backend，应用使用普通 Dock、
标准菜单和主窗口。其他组合：

```bash
fia create native-app --template native
fia create hybrid-app --template hybrid
fia create service-app --backend bun
```

项目契约由严格的 `fia.toml` schema 2、`native-api/api.fia.json` 和应用自己的
`native/Package.swift` 组成。应用 target 必须生成名为 `FIAAppExecutable` 的产品，并精确依赖
与 npm CLI 相同版本的 FIA Swift Package。

## 使用本地 FIA 源码调试

全局 link 的 FIA 可以通过 `--local` 创建同时依赖本地 JavaScript 包和 Swift 源码的项目，
无需发布 npm 版本或创建 Git tag。

```bash
# 在 FIA 源码仓库中构建 CLI 和 SDK
bun install
bun run cli:build

# 首次使用时注册全局 link，已经 link 的可以跳过
cd packages/cli
bun link
cd ../../..

# 在 FIA 仓库旁创建调试项目，也可以切换到其他目录创建
fia create fia-playground --local
cd fia-playground
bun run dev
```

`--local` 从当前 CLI 的真实路径定位源码仓库，将 `@semicoder/fia` 设置为
`link:@semicoder/fia`，复用在 `packages/cli` 中注册的 [Bun link](https://bun.com/docs/pm/cli/link)，
并将 Swift 依赖设置为指向仓库根目录的 `.package(name: "fia", path: ...)` 绝对路径。
安装后会验证 JavaScript 包确实链接到同一源码仓库。项目会自动安装依赖；也支持搭配 `--no-install`、
`--template native|web|hybrid` 和 `--backend bun`。发布安装的 CLI 不包含完整源码仓库，
不能使用 `--local`。

- 修改 FIA CLI、client、backend 或 Vite 集成后，在 FIA 仓库运行 `bun run cli:build`，
  然后重启调试项目的 `bun run dev`。全局 link 的入口仍使用 `dist` 构建产物。
- 修改 FIA Swift 源码后，重启项目的 `bun run dev`，SwiftPM 会增量编译本地源码。
- 修改应用前端使用 Vite 热更新；修改创建模板后需新建项目验证。

本地项目依赖当前机器的 Bun link 和 Swift 源码路径；移动源码仓库后需要重新 link 并更新路径。
`--local` 仅替换 FIA 自身依赖，其他 npm 和 SwiftPM 依赖仍按正常流程安装。

## 命令

- `create`：生成 Native、Web 或 Hybrid 项目，可选 Bun。
- `dev`：使用稳定的 `.fia/dev/<App>.app` 启动开发应用；`--browser chrome|edge` 启动 Browser Companion。
- `run`：构建并运行生产布局。
- `generate` / `generate --check`：确定性生成 Swift protocol/Codable 与 TypeScript client。
- `check`、`test`、`describe --json`、`doctor --json`：提供稳定的本地及机器可读检查。
- `build`：按配置裁剪并签名 `.app`。
- `release --channel stable|beta`：生成公证 full-update ZIP、SHA-256、appcast 和验证报告，不上传。

FIA 2.0 不兼容 1.x，也不包含旧配置、预编译 Host、自定义 Host shim 或 `package` 命令。

详细契约见 [FIA 2.0 框架文档](docs/framework/README.md)。

## 创建项目向导

运行 `fia create` 可依次填写项目名，选择 Web、Native 或 Hybrid 模板，以及是否启用
Bun Backend、初始化 Git 和安装依赖。使用方向键选择、回车确认；Ctrl+C 取消，退出码为
130，向导取消时不会创建文件。默认选择 Web、不启用 Backend、不初始化 Git、安装依赖。

`fia create my-app` 跳过项目名问题；显式参数跳过对应问题。`--local` 仅通过参数指定。
支持 `--template native|web|hybrid`、`--backend bun` / `--no-backend`、
`--git` / `--no-git`、`--install` / `--no-install`；相反开关不能同时使用。

```bash
fia create
fia create my-app --template hybrid --git
fia create script-app --yes --no-install
```

`-y` / `--yes` 跳过所有问题，未指定选项采用默认值。CI 或 stdin/stdout 非 TTY 时也不会
进入交互；这些情况下必须提供项目名。项目名须为小写 kebab-case，目标目录不能已存在。

## 原生应用扩展

窗口关闭/恢复策略、可等待进程组、退出回调和可嵌入 Web 内容见
[迁移与 API 说明](docs/framework/native-refactor-migration.md)。
运行 `swift run FIAWorkbenchExample` 查看[原生工作台参考实现](examples/native-workbench/README.md)。
