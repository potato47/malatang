# 产品定位与边界

## 1. 产品定位

FIA Framework 是一个 macOS-only 的桌面 UI 框架，重点优化以下应用形态：

- 使用 Web 技术构建的本地桌面工具
- 本地优先的数据应用和控制面板
- 后台常驻的状态栏工具
- 需要调用 macOS 原生窗口和系统能力的 Web UI
- 由 TypeScript 团队开发并以原生 `.app` 分发的应用

它不是通用跨平台 GUI 工具包，也不是特定业务领域的应用运行时。框架只负责桌面 UI、
Host/Runtime 生命周期、安全通信、原生能力接入和构建发布。

## 2. 核心价值

### TypeScript 全栈

前端组件、应用后端、通信类型和大部分测试共用 TypeScript 类型系统。

### 系统 WebView

使用 macOS 自带的 WebKit 渲染 HTML/CSS，不捆绑 Chromium。框架接受 WebView UI 的
性能边界，并提供与原生窗口和系统服务之间的窄接口。

### 极薄原生层

Swift 仅负责必须由 macOS 原生 API 实现的功能。默认宿主是可复用预编译二进制，项目无需生成 Xcode 工程。

### UI 框架优先

框架只提供能够跨应用复用的 UI 基础设施。业务编排、第三方服务和领域协议由
应用自行选择依赖和实现，不进入 FIA Host、Runtime 协议或公共 API。

## 3. 目标

- 五分钟内创建并运行一个 macOS 桌面应用。
- 单个命令启动 Swift 宿主、Bun 服务和前端热更新。
- 单个命令生成可双击运行的 `.app`。
- 提供 Dock、状态栏、窗口置顶、通知、快捷键和文件选择器。
- Swift 和 Bun 具备可预测的同步退出、异常检测和恢复机制。
- 为 UI、Bun 后端和原生能力提供有边界的通信协议。
- 支持 Developer ID 签名、公证和 ZIP/DMG 分发。

## 4. 非目标

首期不包含：

- Windows 或 Linux 支持
- iOS/iPadOS 支持
- 完全原生控件渲染
- 替代浏览器布局引擎
- Mac App Store 发布保证
- 无限制地向网页暴露 Bun、Swift 或系统 API
- 完整自动更新服务端；首期只预留更新接口
- 多 WebView 浏览器产品能力
- 特定业务领域的编排引擎、服务端 SDK 或数据层
- 内置终端、进程管理器、源码管理或开发工具服务

## 5. 目标用户

主要用户是熟悉 Bun、TypeScript、React/Solid/Svelte 等 Web 技术，但不希望维护完整
Swift/AppKit 工程的开发者。

Swift 开发者可以通过可选原生插件扩展框架，但这不是普通应用的必经路径。

## 6. 首期技术约束

- macOS 14+
- Apple Silicon
- Bun full-stack standalone executable
- Swift/AppKit + `WKWebView`
- localhost HTTP + WebSocket
- 站外 Developer ID 分发
- 单实例应用优先

这些约束用于快速完成闭环，不代表长期能力上限。
