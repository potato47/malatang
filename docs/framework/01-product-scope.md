# 产品范围

## 定位

FIA 将 macOS 状态栏 App 作为容器宿主，将应用实现放入一个启动即常驻的 Bun Backend。
Backend 可提供任意 HTTP API、WebSocket 和前端页面，也可完全不提供 UI。

## 固定边界

- Swift Host 始终存在状态栏入口，并监管唯一 Backend 子进程。
- Backend 与 Host 只通过 stdin/stdout 单行 JSON 通信，日志写 stderr。
- 浏览器/WebView 只使用 HTTP、WebSocket 和 URL，不可直接调用 Host。
- 生产 Backend 编译成 arm64 standalone Mach-O，不依赖系统 Bun。
- loopback 服务不支持 LAN 或远程监听。
- 不兼容旧静态 UI、WebKit bridge、Native MCP、外部 MCP Server 或 UI-only 配置。

应用自己的数据库、第三方服务、MCP 客户端或其他子进程都属于 Backend 内部实现，FIA Host
不感知也不定义其协议。
