# FIA Framework 设计文档

> 当前协议：MCP `2026-07-28` modern-only
>
> 公共配置：schema 3
>
> Host 配置：schema 5
> 平台：macOS 14+ / Apple Silicon

FIA 使用一个单一通信模型：静态 Web UI 通过 WebKit transport 访问 MCP；`fia.native`
在 Swift Host 进程内执行，其他 server ID 一对一映射到独立 stdio 子进程。

```text
Swift/AppKit Host
├── WKWebView ── WebKit MCP transport ── MCP Router
│                                  ├── fia.native (in-process)
│                                  ├── app (stdio)
│                                  └── <server-id> (stdio)
└── static UI / exact localhost HMR origin
```

## 文档

1. [产品定位与边界](./01-product-scope.md)
2. [系统架构](./02-architecture.md)
3. [项目结构、配置与 CLI](./03-cli-and-project.md)
4. [MCP 生命周期](./04-runtime-lifecycle.md)
5. [Native MCP 能力](./05-native-capabilities.md)
6. [安全模型](./06-security.md)
7. [构建、签名与发布](./07-build-and-release.md)
8. [路线图](./08-roadmap.md)
9. [架构决策记录](./09-architecture-decisions.md)

旧 Bun Runtime、Swift Backend、Backend RPC 及其兼容协议均已删除。Bun 仍是 UI
开发/构建工具，并作为默认应用 MCP Server 的 standalone 打包器，但不是生产依赖。
