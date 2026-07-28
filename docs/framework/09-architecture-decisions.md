# 架构决策记录

## ADR-001：macOS-only、系统 WebKit

**状态：已接受**

首版固定 macOS 14+ arm64，以 AppKit/WebKit 获得系统窗口和较小分发体积，不引入跨平台
窗口抽象或 Chromium。

## ADR-002：预编译通用 Swift Host

**状态：已接受**

普通项目不编译 Swift、不生成 Xcode 工程。CLI 内嵌版本化 Host，并用 manifest、Mach-O
架构和 SHA-256 校验。Swift 只维护通用原生能力和进程监督。

## ADR-003：MCP 是唯一应用能力协议

**状态：已接受，取代旧 Runtime/Backend RPC 决策**

UI、应用逻辑、外部扩展和 Native API 统一采用 MCP `2026-07-28`。不保留 legacy 协议、
迁移 shim 或第二套 Backend bridge。MCP 是控制和结构化数据通道，不承担大文件与高频流。

## ADR-004：WebKit 自定义 MCP transport

**状态：已接受**

浏览器使用官方 TypeScript MCP Client；自定义 transport 只发送
`{bridgeVersion, serverId, message}`。Host 使用 DOM 事件回传未经改写的 MCP JSON-RPC 和
连接状态。精确 origin 与 main-frame 校验是授权边界。

## ADR-005：Native API 是进程内虚拟 MCP Server

**状态：已接受**

`fia.native` 在 Host 进程内实现 tools/resources/subscriptions。`@semicoder/fia/native`
保留 typed facade，但不能拥有独立协议。

## ADR-006：外部 Server 一对一 stdio 子进程

**状态：已接受**

每个 server ID 独享进程、pipe、工作目录、失败与重启状态。首次请求延迟启动；意外退出后
不后台循环重启，下一次连接再按需启动。

## ADR-007：Bun 是工具，不是生产运行时依赖

**状态：已接受**

Bun 负责 UI bundling/HMR，并将唯一 `mcp.app.entry` 编译为 standalone arm64 Mach-O。
开发时 Bun 直接执行生成 runner；最终用户环境不要求安装 Bun。

## ADR-008：扩展只接受项目内二进制

**状态：已接受**

额外 Server 不支持 PATH、shell、包管理器或运行时下载。公共配置验证项目内物理路径和执行
权限；生产再验证 arm64 Mach-O、modern discover、签名和 SHA-256。

## ADR-009：严格 modern-only 版本边界

**状态：已接受**

公共 schema 3、Host schema 5、bridge 1 和 MCP `2026-07-28` 必须精确匹配。未知字段与所有
旧配置直接失败，以较小实现面换取清晰行为。

## ADR-010：静态生产 UI、精确开发 origin

**状态：已接受**

生产 UI 位于 `Contents/Resources/UI`，没有 UI Runtime。开发由 CLI 管理临时 Bun HMR
Server，Host 只授权该次启动的精确 `127.0.0.1` origin。

## ADR-011：inside-out 签名和签名后哈希

**状态：已接受**

先签名并验证 Server，再对签名后字节计算配置 SHA-256，然后签名 Host 和 App。Host 启动
包内 Server 时再次验证哈希。

## 待决策

- Developer ID/hardened runtime 的最小 entitlement。
- 恶意第三方 Server 的 App Sandbox/XPC 模型。
- 大文件和高频流的旁路传输。
- Universal Binary 和自动更新信任链。
