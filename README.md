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
