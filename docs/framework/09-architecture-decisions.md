# 架构决策记录

## ADR-001：只支持 macOS

**状态：已接受**

选择 macOS-only，以 AppKit/WebKit 获得稳定系统集成，避免引入跨平台窗口抽象。未来若支持其他平台，应新增平台 Host，而不是削弱 macOS Host 能力。

## ADR-002：Bun 承载前端与后端

**状态：已接受**

应用 UI 资源、HTTP/WebSocket 服务和业务逻辑由同一个 Bun standalone executable 承载。减少资源分发和多后端协议复杂度。

## ADR-003：WebView 加载 localhost 服务

**状态：已接受**

相比自定义 URL scheme，localhost 更自然地支持 HTTP、WebSocket、HMR、streaming 和现有 Web 开发工具。代价是必须实现 token、Origin/Host 校验和导航限制。

## ADR-004：Swift 是通用宿主，不嵌入 Bun

**状态：已接受**

Swift 通过子进程启动 Bun，而不是通过 FFI 嵌入运行时。这样隔离崩溃和内存，避免依赖不稳定的 Bun embedding/FFI 接口。

## ADR-005：默认使用预编译 Host

**状态：已接受**

普通项目不编译 Swift、不生成 Xcode 工程。CLI 内嵌版本化 Host。需要原生扩展时才启用 SwiftPM。

## ADR-006：stdin 是父进程生命信号

**状态：已接受**

Host 独占 Bun stdin pipe 写端。父进程消失会产生 EOF，Bun 进入 shutdown。正常退出仍使用 shutdown、SIGTERM、SIGKILL 分级回收。

## ADR-007：UI 业务通信绕过 Swift

**状态：已接受**

UI 通过 HTTP/WebSocket 直接连接 Bun。Swift bridge 只处理必须原生实现的能力，避免 Swift 成为高频应用数据的中转瓶颈。

## ADR-008：首期 Developer ID 站外分发

**状态：已接受**

首期优先完成 Developer ID、hardened runtime 和公证链路，以验证站外分发闭环。
Mac App Store 的沙箱、entitlement 和审核兼容性作为独立发布目标评估。

## ADR-009：不将置顶与跨桌面绑定

**状态：已接受**

`alwaysOnTop`、`visibleOnAllSpaces`、`visibleOverFullScreen` 是独立行为，分别映射 AppKit window level 和 collection behavior。

## ADR-010：首期 Apple Silicon

**状态：已接受**

先完成 arm64 垂直闭环。x64 和 Universal Binary 在签名、公证和 Bun embedded assets 验证完成后加入。

## ADR-011：启动秘密通过生命周期管道传递

**状态：已接受**

Host 启动 runtime 后，通过 stdin 生命周期管道发送单行 initialize NDJSON，其中包含
bootstrap/control token、父 PID 和数据目录。秘密不放入环境变量或命令行。后续 shutdown
消息复用同一管道；Host 意外退出时的 EOF 继续作为不可伪造的父进程死亡信号。

## ADR-012：框架核心保持业务无关

**状态：已接受**

FIA 只负责桌面 UI、Host/Runtime 生命周期、安全通信、原生能力接入和构建发布。
特定业务领域的编排、第三方服务和数据协议由应用自行实现，不进入 Host、Runtime 控制
协议、native bridge 或 FIA 公共 API。场景代码可以存在于独立应用或示例中，但不能成为
框架核心依赖。

## ADR-013：阶段 1 正式使用 FIA 名称

**状态：已接受**

框架正式名称为 FIA Framework，公共命令为 `fia`，CLI 发布包为 `@semicoder/fia`。根仓库包继续
保持私有，只承载工作区开发、风险原型和统一验证脚本；用户 CLI 使用独立包发布和版本化。

## ADR-014：默认项目模板使用 React

**状态：已接受**

`fia create` 的阶段 1 默认模板使用 React。React 是目标 TypeScript 用户中覆盖最广的 UI
生态，首版不增加模板选择参数；Solid、vanilla 和其他 UI 框架可以在创建闭环稳定后以可选
模板加入。React 选择只影响脚手架，不使 React 成为 Host 或 Runtime 的框架依赖。

## ADR-015：首版脚手架直接使用 Bun.serve

**状态：已被 ADR-016 取代**

首版 React 模板直接调用 `Bun.serve`，先提供可在浏览器运行的 HTTP Hello、WebSocket Echo
和 HMR 示例。这个入口不兼容 Host 的 bootstrap、认证和 stdin 生命周期协议，也不构成稳定
Runtime API。实现 `fia dev/run/build` 时必须迁移为 FIA 托管 Server；模板 `/ws` 的消息格式
不承诺兼容。

## ADR-016：应用入口使用声明式 defineApp

**状态：已接受**

阶段 1 的 `src/server.ts` 默认导出 `defineApp({ routes, fetch, websocket })`，UI HTML 由
`fia.config.ts` 的 `ui` 字段独立指定。FIA 独占 `Bun.serve`、随机端口、认证、内部路由与
Host 生命周期。旧式直接 `Bun.serve` 入口明确报迁移错误，不自动改写源码。

## 待决策事项

- HTTP RPC 与 WebSocket RPC 的职责分界
- native plugin 的 ABI/API 稳定策略
- updater 选型与信任模型
- 是否默认启用严格 native watchdog
- 最低 macOS 版本是否长期保持 14

## 参考资料

- [Bun standalone executable](https://bun.sh/docs/bundler/executables)
- [Bun full-stack dev server](https://bun.sh/docs/bundler/fullstack)
- [Bun HTTP server](https://bun.sh/docs/runtime/http/server)
- [Swift Package Manager build](https://www.swift.org/documentation/server/guides/building.html)
- [NSApplication activation policy](https://developer.apple.com/documentation/appkit/nsapplication/activationpolicy-swift.enum)
- [NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem)
- [NSWindow collection behavior](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct)
- [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
