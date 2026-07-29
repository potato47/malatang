# Native MCP 能力

`fia.native` 在 Host 进程内实现 MCP tools、resources 和 subscriptions。浏览器端的
`@semicoder/fia/native` 只提供类型化易用接口，所有实际操作仍是 `tools/call`。

## 当前 tools

| Tool                              | Typed facade                               |
| --------------------------------- | ------------------------------------------ |
| `native.getState`                 | `native.getState()`                        |
| `app.quit`                        | `native.app.quit()`                        |
| `app.showDock` / `app.hideDock`   | `native.app.showDock()` / `hideDock()`     |
| `window.show` / `hide` / `focus`  | `native.window.*`                          |
| `window.setAlwaysOnTop`           | `native.window.setAlwaysOnTop()`           |
| `window.setVisibleOnAllSpaces`    | `native.window.setVisibleOnAllSpaces()`    |
| `window.setVisibleOverFullScreen` | `native.window.setVisibleOverFullScreen()` |
| `statusBar.setVisible`            | `native.statusBar.setVisible()`            |
| `statusBar.setIcon`               | `native.statusBar.setIcon()`               |

状态包含应用 mode、Dock/状态栏可见性、状态栏 symbol，以及窗口 visible、focused、
always-on-top 和 Spaces 行为。

## 状态资源与通知

Native Server 提供当前桌面状态 resource，并在窗口、Dock 或状态栏状态改变时发送更新。
typed facade 同时提供 `native.onEvent()` 以便常见 UI 直接消费状态变更和状态栏点击。

## 扩展原则

- 可复用原生能力优先建模为 MCP tool/resource，而不是新增 WebKit handler。
- 输入、输出与错误都声明 schema。
- 能读取的稳定状态优先提供 resource。
- 仅向主 frame 的精确应用 origin 暴露。
- 文件面板、通知、外部打开和 Keychain 作为后续 Native MCP 能力加入。
