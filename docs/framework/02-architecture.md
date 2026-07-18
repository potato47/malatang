# 系统架构

## 1. 组件划分

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
- 受限的 JavaScript-to-native bridge

### Bun Application Runtime

每个应用独立编译的全栈可执行文件，负责：

- 提供 HTML、JavaScript、CSS 和静态资源
- HTTP API 与 WebSocket RPC
- 应用业务逻辑和状态
- 应用数据持久化
- 响应 Host 发出的生命周期消息

### Web UI

运行在 WKWebView 中，可使用 React、Solid、Svelte 或无框架 TypeScript。UI 只能通过经过验证的 HTTP/WebSocket API 访问 Bun，通过窄接口 native bridge 访问 Swift。

## 2. 启动序列

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
- 普通查询：HTTP JSON
- 双向应用命令和状态事件：WebSocket
- 大文件：HTTP streaming

WebSocket 协议需要支持：

- request / response
- event
- stream
- cancellation
- error serialization
- protocol version
- backpressure

### UI 与 Swift

使用 `WKScriptMessageHandler` 提供少量原生命令：

- `window.*`
- `app.*`
- `statusBar.*`
- `dialog.*`
- `notification.*`
- `keychain.*`

不得提供任意 Objective-C selector、任意 Swift 类型调用或通用进程执行 bridge。

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
- project config schema

Host 和 runtime 主版本不匹配时，应显示兼容性错误页面，而不是继续运行未知协议。
