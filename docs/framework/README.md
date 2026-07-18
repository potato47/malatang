# FIA Framework 设计文档

> 状态：Draft  
> 正式名称：FIA Framework
> CLI 命令：`fia`  
> 首期平台：macOS 14+，Apple Silicon

FIA Framework 是一个使用 TypeScript 和 Web UI 构建 macOS 桌面应用的 GUI 框架。应用的前端、后端和静态资源由 Bun 编译为一个可执行文件；一个轻量 Swift/AppKit 宿主负责原生窗口、`WKWebView`、Dock、状态栏、系统权限和进程生命周期。

框架的目标是让开发者使用 TypeScript 和 Web UI 生态完成绝大多数工作，同时获得比 Electron 更小的分发体积和更直接的 macOS 原生集成。

## 核心架构

```text
FIA.app
└── Contents
    ├── MacOS
    │   ├── FIA              Swift/AppKit 通用宿主
    │   └── fia-runtime      Bun 全栈单文件运行时
    ├── Resources
    │   ├── fia-config.json
    │   └── AppIcon.icns
    └── Info.plist
```

运行时进程关系：

```text
Swift/AppKit Host
├── WKWebView ── HTTP/WebSocket ──┐
└── lifecycle pipe ───────────────┤
                                  ▼
                          Bun application runtime
                          ├── HTTP/WebSocket server
                          ├── application backend
                          └── application state
```

## 文档索引

1. [产品定位与边界](./01-product-scope.md)
2. [系统架构](./02-architecture.md)
3. [项目结构、配置与 CLI](./03-cli-and-project.md)
4. [运行时与进程生命周期](./04-runtime-lifecycle.md)
5. [macOS 原生能力](./05-native-capabilities.md)
6. [安全模型](./06-security.md)
7. [构建、签名与发布](./07-build-and-release.md)
8. [实施路线图](./08-roadmap.md)
9. [架构决策记录](./09-architecture-decisions.md)
10. [阶段 0 运行时协议](./10-phase0-runtime-protocol.md)
11. [阶段 0 验证基线](./11-phase0-validation.md)

## 第一阶段结论

- 使用系统 `WKWebView`，不携带 Chromium。
- Bun 负责 UI 资源、HTTP/WebSocket、应用后端和业务状态。
- Swift 宿主保持通用，不为每个普通项目重复编译。
- 开发、构建和分发全部通过 `fia` CLI 完成，不生成或启动 Xcode 工程。
- 首版输出 Apple Silicon 应用；Universal Binary 和 Intel 支持后置。
- 首版以 Developer ID 站外分发为目标，不以 Mac App Store 为目标。

## 当前实施边界

阶段 0 风险原型已经完成。当前阶段 1 实现了独立的 `@fia/cli` 包、稳定的 `fia` 命令入口
和 `fia doctor` 环境诊断；AppKit Host、Bun standalone runtime、localhost/WebSocket
安全边界、`.app` 组装和进程回收继续作为回归基线。公共项目配置、
`fia create/dev/run/build`、预编译 Host、HMR、状态栏和 native bridge 尚未实现。

FIA 只提供通用桌面 UI 基础设施，不内置特定业务领域的编排、服务端 SDK 或开发工具。
应用可以在自己的 Bun 代码中选择所需依赖，但这些依赖不属于 FIA 公共 API。
