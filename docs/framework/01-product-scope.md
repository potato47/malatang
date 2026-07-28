# 产品定位与边界

FIA 是 macOS-only 的桌面 UI 框架，适合使用 TypeScript/Web 技术开发、本地运行并以原生
`.app` 分发的工具、控制面板和状态栏应用。

## 核心价值

- 使用系统 `WKWebView`，不分发 Chromium。
- UI 可选择 React 等任意 Bun 能打包的前端框架。
- 应用能力、扩展能力和原生能力统一使用 MCP `2026-07-28`。
- Swift Host 是可复用预编译资产；普通应用不维护 Swift/Xcode 工程。
- 默认 TypeScript MCP Server 由 Bun 编译为 standalone Mach-O，生产不依赖系统 Bun。
- 额外扩展通过独立 stdio MCP Server 接入，不扩大 Host 的公共 ABI。

## 首版边界

- macOS 14+、Apple Silicon arm64。
- 单主 WebView、最多 64 个配置 Server。
- 所有打包 Server 都视为项目内可信代码。
- MCP 用于控制和结构化数据；单消息上限 1 MiB，不承担大文件、媒体或高频流。
- 不支持 PATH 搜索、shell 启动、运行时下载或动态安装 Server。
- 不兼容旧 `runtime`、`swift`、`entry`、Backend RPC 或旧 MCP 协议。
- 首版不提供 App Sandbox/XPC 恶意代码隔离、Mac App Store 保证、自动更新或跨平台 Host。

## 职责边界

Host 只负责窗口/WebView、原生系统能力、安全桥接、子进程监督和应用生命周期。业务领域、
第三方服务、数据存储和非原生扩展属于应用 MCP Server；可复用的原生能力按 tools/resources
逐步加入 `fia.native`。
