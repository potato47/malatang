# 系统架构

## 组件

```text
Web UI
  │ official TypeScript MCP Client
  │ custom WebKit transport
  ▼
Swift/AppKit Host
  ├── MCP Router ── fia.native (in-process)
  ├── Supervisor ── app (stdio child)
  └── Supervisor ── external server-id (stdio child)
```

- **Web UI**：开发时来自精确的 `http://127.0.0.1:<port>`，生产时来自
  `Contents/Resources/UI`。
- **WebKit transport**：发送 `{bridgeVersion, serverId, message}`；`message` 保持原始
  MCP JSON-RPC，不做方法或 payload 改写。
- **MCP Router**：`fia.native` 路由到进程内 Server，其他 ID 路由到一对一子进程。
- **Supervisor**：延迟启动、stdio framing、stderr 聚合、失败状态、按需重启和进程回收。

## 协议边界

- MCP protocol：`2026-07-28` modern-only。
- Bridge version：1。
- Host config schema：5。
- 公共 config schema：3。
- 消息格式：stdout/stdin 单行 UTF-8 JSON-RPC。
- 单消息：1 MiB。
- 并发发送：128。
- 普通调用超时：30 秒。
- 首次 `server/discover`：10 秒。

WebKit transport 和 stdio transport 只封装传输，不重新定义 MCP 请求、响应、通知、错误、
tool、resource 或 subscription 语义。

## Native MCP

`fia.native` 是保留的虚拟 Server，不启动子进程。当前公开：

- tools：应用退出/Dock、窗口显示与状态、状态栏显示与图标。
- resources：当前桌面状态。
- subscriptions：桌面状态更新通知。

`@semicoder/fia/native` 是对这些 MCP 能力的 typed facade，不是第二套桥协议。

## 外部 Server

`app` 是唯一可以通过 TypeScript `{entry}` 配置的 Server。FIA 为它生成 stdio runner，
验证 `defineMcpServer` 工厂并调用 `serveStdio(factory, { legacy: "reject" })`。

其他 ID 必须配置项目内 `{executable}`。生产构建只接收具有执行权限的 arm64 Mach-O，
复制到 `Contents/Helpers/MCPServers/<id>` 后签名和记录 SHA-256。

每个 Server 的工作目录固定在应用 Application Support 的专属目录。Server 不共享 stdin、
stdout、请求 ID、失败状态或重启周期。

## 连接恢复

Server 非预期退出时，Host 关闭 transport、拒绝未完成调用并向页面发送失败状态；不会后台
循环重启。下一次连接按需拉起新的进程。

FIA facade 在重启后建立新 Client、重新 discover，并恢复由 facade 创建的订阅。通过
`client()` 取得的原始官方 Client 会关闭，调用方必须重新获取。主文档 reload 或 WebContent
崩溃会清理页面会话并重启所有外部 Server。
