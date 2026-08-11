# Backend 生命周期

1. Host 启动并立即显示 Starting/Quit 状态栏菜单。
2. Host 校验 Backend 路径与生产 SHA-256，创建 Application Support 工作目录。
3. Host 无 shell 启动 Backend，连接 stdin/stdout/stderr 并发送 `initialize`。
4. runtime 建立安全会话和 Bun.serve，运行 `start` 钩子，再发送 `ready`。
5. Backend 可处理 HTTP/WS，并通过 Host client 调用原生能力。

Backend 异常退出后按 0.5、1、2、4、8 秒退避重启；稳定运行 60 秒后清零失败计数。五次均
失败时 Host 显示原因、Retry 和 Quit。Retry 清零计数。首次随机端口会在同一 Host 生命周期
内复用。

Host 原生请求按 ID 异步执行。普通请求 30 秒超时；交互式文件面板和通知授权等待用户完成，
可由 Backend 的 AbortSignal 取消。Backend 退出或重启会取消全部尚未完成的原生请求。

正常退出时 Host 发送 `host.shutdown`，runtime 调用 `stop` 并关闭 HTTP/WS；五秒未退出则
SIGTERM，再等待两秒后 SIGKILL。Host 自身退出始终回收 Backend。

热重载也会先调用旧定义的 `stop`。若 `stop` 关闭了模块级单例持有的数据库、连接或其他资源，
必须同时把模块级引用清空；只调用 `close()` 会让新定义继续取得已经关闭的 handle。
