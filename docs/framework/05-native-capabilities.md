# macOS 原生能力

> 状态：阶段 2 首个桌面外壳切片已实现。文件面板、通知、外部打开、Keychain、自定义菜单与
> 多窗口仍是后续能力。

## 1. 应用运行模式

框架提供三个预设：

| 模式 | Dock | 状态栏 | 关闭最后窗口 |
|---|---:|---:|---|
| `dock` | 显示 | 隐藏 | 默认退出 |
| `statusBar` | 隐藏 | 显示 | 保持运行 |
| `hybrid` | 显示 | 显示 | 保持运行 |

映射到 AppKit：

- `dock` / `hybrid`：`NSApplication.ActivationPolicy.regular`
- `statusBar`：`NSApplication.ActivationPolicy.accessory`

Host 不写 `LSUIElement`，统一使用 activation policy，使 `app.showDock/hideDock` 可以在运行时切换。
Dock 与状态栏不能同时隐藏，避免应用失去恢复入口。

## 2. 状态栏

使用 `NSStatusBar.system.statusItem`。Host 必须强引用 `NSStatusItem`。

首个切片支持：

- template image
- 左键显示/隐藏主窗口
- Host 管理的显示/隐藏和退出菜单
- 运行时 SF Symbol 切换
- “退出”触发完整进程关闭状态机

状态栏图标不能成为唯一恢复入口；配置错误或图标不可见时，应支持通过再次启动应用显示主窗口。

## 3. 窗口

当前公共配置：

- 初始和最小尺寸
- 记忆窗口 frame，并约束到当前可见屏幕
- 关闭即隐藏

置顶能力拆分为独立选项：

- `alwaysOnTop`：`.floating` window level
- `visibleOnAllSpaces`：`.canJoinAllSpaces`
- `visibleOverFullScreen`：`.fullScreenAuxiliary`

三者不得隐式绑定。置顶不代表跨桌面，也不保证覆盖系统安全窗口。

应用主窗口使用正常 `NSWindow`。只在浮动工具面板场景提供 `NSPanel`，避免非激活面板影响 WebView 键盘输入。

## 4. Native bridge

当前 `@semicoder/fia/native` 命令：

```text
app.quit
app.showDock
app.hideDock
window.show
window.hide
window.focus
window.setAlwaysOnTop
window.setVisibleOnAllSpaces
statusBar.setVisible
statusBar.setIcon
```

另提供 `native.getState`、`native.isAvailable()` 和 `native.onEvent()`。事件包含 `stateChanged`
与 `statusBarClicked`。所有命令有严格 schema 和明确返回类型；bridge 仅接受当前 runtime 精确
origin 的主 frame，单条消息上限 64 KiB。

## 5. 运行时切换

应用可以通过 bridge 动态切换 Dock、状态栏和窗口标志。运行设置写入 Application Support，
由启动配置提供默认值、合法用户设置覆盖默认值。窗口可见、焦点、最小化和全屏状态不持久化。

## 6. 后续能力

- 全局快捷键
- 登录时启动
- Dock menu
- 文件拖放和 Finder Services
- Share Extension
- Accessibility 能力
- 自动更新
- 原生菜单命令路由
- 文件/目录/保存面板
- 通知、外部打开和 Keychain

涉及高权限 entitlement 的能力必须独立设计并经过安全评审，不默认开启。
