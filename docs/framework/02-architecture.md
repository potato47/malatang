# 系统架构

## 1. 组件划分

本节描述目标组件职责。阶段 2 首个切片已在单窗口 Host 上实现状态栏、桌面状态持久化和
native bridge；多窗口、其余系统服务、公证和分发产物仍按路线图在后续阶段实现。

### `fia` CLI

由 Bun/TypeScript 编写并编译为单文件可执行程序，负责：

- 项目创建和模板升级
- 开发环境编排
- Bun 应用编译
- Swift 宿主选择或构建
- `.app` 组装
- 签名、公证和分发产物生成
- 环境诊断

### Swift/AppKit Host

通用 macOS 宿主，负责：

- `NSApplication` 和应用生命周期
- `NSWindow`、`WKWebView` 和多窗口
- Dock activation policy
- `NSStatusItem` 状态栏入口
- 菜单、快捷键、通知、文件面板和 Keychain
- 启动、监控和停止 Bun 进程
- 启动、监控、热重启和停止应用 Swift 后端进程
- 受限的 JavaScript-to-native bridge

### Bun Application Runtime

每个应用独立编译的全栈可执行文件，负责：

- 提供 HTML、JavaScript、CSS 和静态资源
- HTTP API 与 WebSocket RPC
- 应用业务逻辑和状态
- 应用数据持久化
- 响应 Host 发出的生命周期消息

### Swift Application Backend

`runtime: "swift"` 项目独占的应用可执行文件，使用随 npm 包发布的 `FIABackend` SwiftPM SDK：

- 使用 `Codable` 注册异步 RPC handler
- 通过 NDJSON stdin/stdout 接收请求、返回响应并主动发送事件
- 通过 `BackendContext` 获取应用数据目录、取消状态和结构化日志
- 开发时由 CLI 增量构建并由 Host 平滑重启；生产时签名为 `fia-backend`

### Web UI

运行在 WKWebView 中，可使用 React、Solid、Svelte 或无框架 TypeScript。UI 通过经过验证的
HTTP/WebSocket API 访问 Bun，或通过独立 backend bridge 访问应用 Swift 后端；系统原生能力
仍只通过窄接口 native bridge 暴露。

## 2. 启动序列

下列序列适用于 Bun 模式：

```text
1. LaunchServices 启动 Swift Host
2. Host 读取 Info.plist 和 fia-config.json
3. Host 创建 bootstrap/control token 与生命周期管道
4. Host 启动 fia-runtime，并通过 stdin 写入 initialize 消息
5. Bun 校验 initialize 消息后绑定 127.0.0.1:0
6. Bun 在 stdout 输出单行 ready JSON
7. Host 校验 ready 消息、PID 和随机端口
8. Host 使用 control token 完成 health probe
9. Host 创建 non-persistent data store 的 WKWebView，只允许访问本次 origin
10. Host 加载一次性 bootstrap URL
11. Bun 校验 token、设置 HttpOnly 会话 cookie、废弃 bootstrap token 并重定向首页
12. UI 使用会话 cookie 和 `fia.v1` 子协议建立 WebSocket 会话
```

建议的 ready 协议：

```json
{
  "protocol": 1,
  "type": "ready",
  "port": 49152,
  "pid": 12345
}
```

stdin/stdout 使用最大 16 KiB 的单行 NDJSON。stdout 只允许传宿主协议；应用日志统一
写 stderr。initialize 消息携带 bootstrap token、独立的 control token、父 PID 和数据
目录，秘密不得放入进程环境变量或命令行。

bootstrap URL 形如：

```text
http://127.0.0.1:<port>/__fia/bootstrap/<one-time-token>
```

该 token 只允许使用一次。成功后 Bun 设置 `HttpOnly`、`SameSite=Strict` 的随机会话
cookie 并立即重定向到 `/`，避免凭据长期留在页面 URL 和前端 JavaScript 状态中。
Host 健康检查使用独立 control token，不复用已废弃的 bootstrap token。

## 3. 通信通道

### UI 与 Bun

- 页面与资源：HTTP
- 普通查询、命令调用和下载：HTTP
- 可由 `Response` 表达的单向流：HTTP streaming
- 服务端主动推送和持续双向状态事件：应用 WebSocket

阶段 1 只提供应用 WebSocket handler 和会话安全边界，不规定业务消息格式。若后续提供框架级
WebSocket RPC，应独立版本化并覆盖：

- request / response
- event
- stream
- cancellation
- error serialization
- protocol version
- backpressure

### UI 与 Swift

使用带 Promise reply 的 `WKScriptMessageHandlerWithReply` 提供少量原生命令：

- `window.*`
- `app.*`
- `statusBar.*`
- `dialog.*`
- `notification.*`
- `keychain.*`

公共入口为 `@semicoder/fia/native`。handler 注册在 page world，但仍显式拒绝非主 frame 和
非当前 Runtime 精确 origin。不得提供任意 Objective-C selector、任意 Swift 类型调用或
通用进程执行 bridge。

应用 Swift 后端不进入上述 allowlist。它单独注册 `fiaBackend` handler，公共入口为
`@semicoder/fia/backend`，只接受精确应用 origin 的主 frame，并把 JSON 请求转发给
`fia-backend`。Host 等 UI Runtime 与后端都 ready 后才加载应用页面。

### Host 与应用 Swift 后端

- stdin：`initialize`、`request`、`shutdown`
- stdout：`ready`、`response`、`event`，仅允许最大 1 MiB 的 NDJSON
- stderr：应用日志
- Host 限制 128 个并发请求，默认 RPC 超时 30 秒
- 正常退出依次执行 shutdown、2 秒后 SIGTERM、再 2 秒后 SIGKILL
- 开发重启期间，旧请求返回 `BACKEND_RESTARTED`，未 ready 的新请求返回
  `BACKEND_UNAVAILABLE`

### Swift 与 Bun

首期使用：

- stdin：生命周期和关闭控制
- stdout：结构化启动协议
- stderr：Bun 日志
- HTTP `/__fia/health` + Bearer control token：运行状态检测

阶段 0 的具体消息和限制见[阶段 0 运行时协议](./10-phase0-runtime-protocol.md)。若后续需要
Bun 主动请求复杂原生能力，可扩展一个独立 framed IPC 通道，不复用日志流。

## 4. 数据目录

应用包在签名后视为只读。所有运行数据放在：

```text
~/Library/Application Support/<bundle-id>/
├── database/
├── sessions/
├── logs/
├── cache/
└── settings.json
```

临时数据放在系统提供的 cache 或 temporary directory。密钥只存储在 Keychain，不写入配置文件、日志或 URL。

## 5. 版本兼容

以下组件必须在启动握手中校验版本：

- Host protocol
- Bun runtime protocol
- native bridge API
- Swift backend protocol
- project config schema

当前版本为 Runtime protocol 1、native bridge protocol 1、公共 config schema 2、Host 内部
config schema 4、Swift backend protocol 1。Host 继续读取内部 schema 1–3；协议主版本不匹配时，
应显示兼容性错误页面，而不是继续运行未知协议。
