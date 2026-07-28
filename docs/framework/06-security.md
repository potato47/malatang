# 安全模型

## 信任边界

- 应用 UI 与项目内 MCP Server 属于同一应用信任域。
- 任意网页、iframe、外部导航和非配置 Server ID 均不可信。
- 首版不把项目内第三方 Server 当作恶意代码隔离；需要该边界时引入 App Sandbox/XPC。

## WebKit 桥

- 只接受主 frame。
- 只接受精确应用 origin；开发为 CLI 分配的 `127.0.0.1:<port>`。
- envelope 必须精确包含 `bridgeVersion`、`serverId`、`message`。
- MCP message 必须是合法 JSON-RPC 2.0 且不超过 1 MiB。
- 生产 UI 使用自定义 scheme，并为 CSP script/style 注入运行时随机 nonce。
- 外部导航不能获得 FIA MCP message handler。

## 可执行文件

- 公共配置只允许项目内相对路径。
- 校验词法路径与 `realpath`，拒绝目录穿越和符号链接越界。
- 外部 Server 不经过 shell 或 PATH。
- 生产只接受可执行的 arm64 Mach-O。
- 每个 Server 先签名并严格验证，再对签名后的字节计算 SHA-256。
- Host 启动包内 Server 前再次校验 SHA-256。

## 进程和数据

- Server 一对一独立进程、pipe、工作目录和失败状态。
- stdout 是协议专用通道；stderr 按 server ID 记录。
- 限制 128 并发、30 秒调用、10 秒 discover。
- 崩溃不会触发无限自动重启。
- Application Support 工作目录不赋予额外系统权限；Server 继承应用进程的普通用户权限。

## 当前不覆盖

大文件/媒体/高频流、远程 MCP transport、运行时下载、恶意插件隔离、代码来源证明和
Developer ID 公证不属于当前本地 build 的安全承诺。
