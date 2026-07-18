# 阶段 0 运行时协议

> 状态：Experimental  
> 协议版本：1  
> 最大单行长度：16 KiB（包含换行符）

本协议只用于阶段 0 Host 与 Bun runtime 风险原型，不承诺跨版本兼容。

## 1. Host 到 Runtime

Host 将 Bun stdin 连接到自己独占写端的 pipe。消息使用 UTF-8 单行 NDJSON。

启动后的第一条消息必须是：

```json
{"protocol":1,"type":"initialize","bootstrapToken":"<32-byte-base64url>","controlToken":"<32-byte-base64url>","parentPid":123,"dataDirectory":"/absolute/path"}
```

- 两个 token 独立生成，至少包含 256-bit 随机性。
- `parentPid` 必须等于 Host PID。
- `dataDirectory` 必须是 Host 创建的绝对路径，并同时作为 Runtime 工作目录。
- Runtime 在合法 initialize 到达前不得监听端口或写 ready。

正常退出消息为：

```json
{"protocol":1,"type":"shutdown","reason":"applicationQuit"}
```

Host 写入 shutdown 后关闭 pipe。任何时刻收到 EOF、`SIGTERM` 或 `SIGINT` 都进入同一个
幂等 shutdown 流程。

## 2. Runtime 到 Host

Runtime stdout 只允许协议消息，应用日志必须写 stderr。监听成功后输出：

```json
{"protocol":1,"type":"ready","port":49152,"pid":12345}
```

Host 在 10 秒内只接受一条合法 ready，并验证：

- `protocol == 1`
- `type == "ready"`
- `port` 在 `1...65535`
- `pid` 等于 Host 创建的子进程 PID

失败或超时后 Host 终止 Runtime，不加载 WebView。

## 3. HTTP 会话

Runtime 只绑定 `127.0.0.1:0`，并要求所有请求的 `Host` 精确等于
`127.0.0.1:<actual-port>`。

### Bootstrap

`GET /__fia/bootstrap/<bootstrapToken>` 只成功一次。成功时 Runtime 先废弃 token，再设置：

```text
Set-Cookie: fia_session=<random>; HttpOnly; SameSite=Strict; Path=/
Location: /
```

随后返回 `303 See Other`。无效或重复 token 返回不泄漏细节的 `404`。

### Health

`GET /__fia/health` 要求：

```text
Authorization: Bearer <controlToken>
```

成功响应：

```json
{"protocol":1,"status":"ok","pid":12345}
```

### UI API

`GET /api/hello` 要求有效 `fia_session` cookie，返回：

```json
{"protocol":1,"message":"Hello from FIA"}
```

安全 HTTP 方法若携带 `Origin`，必须与当前 origin 精确相等；非安全方法必须携带并匹配
`Origin`。生产错误不包含内部堆栈。

## 4. WebSocket Echo

`GET /__fia/ws` upgrade 必须同时满足：

- 有效会话 cookie
- 精确 `Origin: http://127.0.0.1:<port>`
- `Sec-WebSocket-Protocol` 包含 `fia.v1`

阶段 0 只支持：

```json
{"protocol":1,"type":"request","id":"1","method":"echo","params":{"message":"hello"}}
```

成功响应：

```json
{"protocol":1,"type":"response","id":"1","result":{"echo":"hello"}}
```

非法消息返回同 ID 的 error；无法解析 ID 时关闭连接。单条消息最大 64 KiB，并设置有限
backpressure 和空闲超时。

## 5. 阶段 0 内部配置

`Contents/Resources/fia-config.json` 使用严格 schema：

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "app": {
    "name": "FIA Prototype",
    "identifier": "dev.fia.prototype",
    "quitOnLastWindowClosed": true
  },
  "window": {
    "width": 1024,
    "height": 700,
    "minWidth": 720,
    "minHeight": 480
  }
}
```

未知字段、错误版本、空名称、非法 bundle identifier 或非正窗口尺寸均导致 Host 在启动
Runtime 前显示配置错误。
