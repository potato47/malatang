# 运行时与进程生命周期

## 1. 目标

- 正常退出时允许 Bun 保存状态和关闭数据库。
- Swift 崩溃或被强制结束时，Bun 能检测父进程消失。
- Bun 崩溃时，Swift 显示故障状态并允许用户手动重启。
- 关闭流程有明确超时，不无限等待。

## 2. 所有权

生产和开发环境都固定由 Swift Host 创建和拥有 Bun runtime：

```text
Swift Host owns Bun runtime
```

禁止 UI 绕过 Host 直接启动独立的 FIA runtime。FIA 的进程所有权到 Bun runtime 为止；
应用代码自行启动的外部进程不属于框架生命周期 API，应用必须自行负责权限、回收和错误处理。

生产配置由 Host 启动包内 `Contents/MacOS/fia-runtime`；开发配置由同一预编译 Host 启动当前
Bun 与 CLI 生成的 `--hot` 入口。两种模式使用相同 stdin/stdout 协议和父进程回收规则，开发
模式不会让 CLI 或 WebView 绕过 Host 直接拥有 Runtime。

## 3. 生命管道

Host 创建专用 pipe，并把读端设置为 Bun stdin。Host 独占写端。

- Host 启动后先写入单行 initialize NDJSON，包含启动秘密、父 PID 和数据目录。
- Host 正常退出：主动写入 shutdown，再关闭写端。
- Host 崩溃或 `SIGKILL`：内核关闭写端，Bun 收到 EOF。
- Bun 收到 stdin EOF：立即进入统一 shutdown 流程。

单行消息最大 16 KiB。bootstrap/control token 只通过此管道传递，不进入环境变量、
命令行、日志或持久化配置。阶段 0 消息定义见[运行时协议](./10-phase0-runtime-protocol.md)。

Bun 同时监听 `SIGTERM` 和 `SIGINT`，进入同一关闭流程。

## 4. 正常退出状态机

```text
RUNNING
  │ app.quit
  ▼
STOP_REQUESTED
  │ send shutdown + close pipe
  ▼
GRACEFUL_WAIT (2s default)
  ├── Bun exits ───────────────► STOPPED
  └── timeout
        ▼
      SIGTERM_WAIT (1s)
        ├── Bun exits ─────────► STOPPED
        └── timeout
              ▼
            SIGKILL ───────────► STOPPED
```

AppKit 退出使用 `applicationShouldTerminate` 的 terminate-later 模式，等待上述状态机完成后再允许 Host 结束。`applicationWillTerminate` 只作为补充，不作为异步关闭入口。

## 5. Bun 关闭顺序

1. 标记 runtime 不再接受新请求。
2. 通知 UI `runtime.shuttingDown`。
3. 停止 HTTP/WebSocket 接收新连接。
4. 在 graceful timeout 内运行应用注册的关闭回调。
5. flush 框架日志并关闭 runtime 持有的服务资源。
6. runtime 以明确状态码退出。

FIA 不提供外部进程 registry 或工作负载恢复系统。应用自己的资源清理不得延长 Host 的
分级退出总时限。

## 6. Bun 异常退出

Host 的 termination handler 区分主动关闭与异常退出：

- 主动关闭：结束应用退出流程。
- 异常退出：显示诊断页、退出状态和“重新启动”按钮。
- 用户选择重启：先完成旧 Runtime 清理，再由同一 Host 建立新会话并启动 Runtime。
- 用户选择退出：进入正常 AppKit 终止和进程回收流程。

阶段 1 不自动重启，避免崩溃循环。带次数阈值和指数退避的自动恢复策略属于后续 hardening，
在实现前不构成公共行为承诺。

## 7. 严格 watchdog 模式

stdin EOF 依赖 Bun 事件循环仍能处理事件。若必须覆盖 Bun 原生死锁或无限 CPU 循环，增加极小 native watchdog：

```text
Swift Host ── death pipe ──► watchdog ── owns ──► Bun runtime
```

watchdog 在 Host pipe EOF 后杀死整个 Bun 进程组。该模式作为后续 hardening 功能，不阻塞首版。

## 8. 应用状态边界

FIA 只提供 Application Support 数据目录和关闭通知，不定义应用数据结构、事务语义或恢复
协议。应用需要自行保证持久化和恢复逻辑的正确性；Host 只报告 runtime 退出状态并提供
重新启动入口。
