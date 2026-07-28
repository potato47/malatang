# MCP Server 与应用生命周期

## Server 启动

外部 Server 不随 Host 启动。页面第一次连接某个 ID 时：

1. Router 校验 server ID。
2. Supervisor 解析已配置 executable。
3. 生产相对路径验证可执行权限和 SHA-256；开发绝对路径允许监听替换。
4. 创建 Application Support 下的 Server 专属工作目录。
5. 启动无 shell 的子进程，并连接 stdin/stdout/stderr。
6. Client 在 10 秒内完成 modern `server/discover`。

stdout 只能输出单行 UTF-8 MCP JSON-RPC；日志必须写 stderr。分片由 Supervisor 缓冲，
非法 JSON、空行污染、超限消息或异常 EOF 都会使当前 transport 失败。

## 停止与失败

- 正常应用退出：停止页面会话和所有外部 Server，再退出 Host。
- CLI 中断：终止 Host；Host 负责回收其 Server。
- Server 崩溃：关闭 transport、清理 pipe、拒绝未完成请求并标记 failed。
- 下次连接：重新启动一次；无后台 crash loop。
- 页面 reload/WebContent 崩溃：清理旧请求和订阅并重启全部外部 Server。

开发热更新使用 Host stdin 上独立的控制消息，仅接受 CLI 启动的开发会话。UI HMR 与 MCP
Server 生命周期相互独立。

## Client 生命周期

`mcp.server(id)` 返回稳定 facade。facade 自己创建的 Client 可在 Server 重启后重建并恢复
订阅；`await server.client()` 返回的原始 Client 属于调用方，在断开后不会透明替换。

## Bun 应用 Server

开发：

```text
bun <generated-runner.ts>
```

生产：

```text
bun build <generated-runner.ts> --compile \
  --target=bun-darwin-arm64 \
  --minify \
  --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig
```

FIA 只接受 `defineMcpServer` 标记的同步工厂。Server 构建后必须在 10 秒内完成
`server/discover` 和 `tools/list` 冒烟验证。
