# 系统架构

## 组件

- **Swift Host**：解析只读配置，建立状态栏，监管 Backend，执行 allowlist 原生命令。
- **Bun Backend**：唯一常驻子进程，运行 `defineBackend`、Bun.serve 和应用生命周期钩子。
- **网页客户端**：系统浏览器或无桥接 WKWebView；只消费应用自己的 HTTP/WS contract。

## 协议

Host 启动 Backend 后发送 `initialize`，包含 stdio 版本、宿主生命周期会话密钥、首选端口、
开发标记和 Application Support 路径。Backend 绑定 `127.0.0.1` 后发送 `ready`。

后续帧统一为：

```json
{"v":1,"type":"request","id":1,"method":"statusItem.setMenu","params":{}}
{"v":1,"type":"response","id":1,"result":null}
{"v":1,"type":"event","event":"statusItem.clicked","payload":{"button":"left"}}
```

stdout 单帧上限 1 MiB，最多 128 个未完成调用，普通调用 30 秒，启动 10 秒。未知版本、
未知帧、日志污染、非法 JSON、重复响应或超限都会使当前 Backend 失败。

## 状态所有权

- Backend 拥有菜单定义、页面 URL、HTTP/WS contract 和业务状态。
- Host 拥有实际 NSStatusItem、NSWindow/WKWebView、Dock 状态和窗口位置持久化。
- Backend 重启复用 Host 会话密钥与首次选定端口；页面重连策略仍由应用前端决定。
