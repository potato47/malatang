# macOS 原生能力

> 状态：阶段 2 目标设计。阶段 1 当前只实现 Dock 单窗口模式、应用菜单、WebView 和 Runtime
> 生命周期；状态栏、多窗口、以下 native bridge 命令和运行时模式切换尚未进入公共 API。

## 1. 应用运行模式

框架提供三个预设：

| 模式 | Dock | 状态栏 | 关闭最后窗口 |
|---|---:|---:|---|
| `dock` | 显示 | 可选 | 默认退出 |
| `statusBar` | 隐藏 | 显示 | 保持运行 |
| `hybrid` | 显示 | 显示 | 保持运行 |

映射到 AppKit：

- `dock` / `hybrid`：`NSApplication.ActivationPolicy.regular`
- `statusBar`：`NSApplication.ActivationPolicy.accessory`

固定的纯状态栏构建可生成 `LSUIElement=true`。需要运行时切换 Dock 时，使用 activation policy，不固定 `LSUIElement`。

## 2. 状态栏

使用 `NSStatusBar.system.statusItem`。Host 必须强引用 `NSStatusItem`。

阶段 2 首批计划支持：

- template image
- 左键显示/隐藏主窗口
- 原生菜单
- 运行状态图标切换
- 未读或需要关注状态
- “退出”触发完整进程关闭状态机

状态栏图标不能成为唯一恢复入口；配置错误或图标不可见时，应支持通过再次启动应用显示主窗口。

## 3. 窗口

基础配置：

- 初始、最小和最大尺寸
- 原生或 hidden-inset 标题栏
- resizable / minimizable / closable
- 毛玻璃材质
- 记忆窗口位置
- 关闭即隐藏
- 多窗口 ID

置顶能力拆分为独立选项：

- `alwaysOnTop`：`.floating` window level
- `visibleOnAllSpaces`：`.canJoinAllSpaces`
- `visibleOverFullScreen`：`.fullScreenAuxiliary`

三者不得隐式绑定。置顶不代表跨桌面，也不保证覆盖系统安全窗口。

应用主窗口使用正常 `NSWindow`。只在浮动工具面板场景提供 `NSPanel`，避免非激活面板影响 WebView 键盘输入。

## 4. Native bridge

建议首期命令：

```text
app.quit
app.showDock
app.hideDock
app.setBadge
window.show
window.hide
window.focus
window.setAlwaysOnTop
window.setVisibleOnAllSpaces
statusBar.setVisible
statusBar.setIcon
dialog.openFile
dialog.openDirectory
dialog.saveFile
notification.requestPermission
notification.show
app.openExternal
keychain.get
keychain.set
keychain.delete
```

所有命令有 JSON schema、明确返回类型和权限要求。native bridge 仅注入受信任的应用 WebView。

## 5. 运行时切换

应用可以通过 bridge 动态切换 Dock、状态栏和置顶状态。运行设置写入 Application Support，由启动配置提供默认值、用户设置覆盖默认值。

## 6. 后续能力

- 全局快捷键
- 登录时启动
- Dock menu
- 文件拖放和 Finder Services
- Share Extension
- Accessibility 能力
- 自动更新
- 原生菜单命令路由

涉及高权限 entitlement 的能力必须独立设计并经过安全评审，不默认开启。
