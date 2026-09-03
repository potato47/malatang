# Desktop 原生能力

原生能力只通过 `defineBackend` 上下文中的 `desktop` 暴露，浏览器 bundle 没有对应导出。
生命周期上下文以及受保护 route/fetch 的第三参数同时提供 `app`；其中 `dataDirectory` 是 Host
预先创建并通过 initialize 帧传入的绝对持久化目录。

- `desktop.windows`：以稳定 ID 创建、接管、查询和列举 `BrowserWindow` handle。
- `desktop.tray`：Host 预创建的单例状态栏资源，提供可见性、SF Symbol、tooltip、动态菜单和事件。
- `desktop.dock`：控制 Dock 可见性并接收 `reopen` 事件。
- `desktop.getState()` / `desktop.quit()`：读取 `dockVisible`、`trayVisible` 或退出应用。
- `desktop.globalShortcuts`：原子替换最多 32 个系统全局快捷键，并接收 `pressed` 事件。
- `desktop.screens`：枚举显示器、逻辑坐标、可见区域、缩放、主屏与鼠标所在屏。
- `desktop.screenCapture`：显式读取/申请屏幕录制授权，并把单屏或屏内区域捕获为临时
  `CapturedImage`。
- `desktop.system`：打开 HTTP(S) URL 或本地路径、在 Finder 定位路径、把路径移入废纸篓。
- `desktop.notifications`：读取/申请授权、发送和移除通知，以及通知点击事件。
- `desktop.dialogs`：打开文件、打开目录和保存文件面板，结果为绝对 POSIX 路径。
- `desktop.clipboard`：读取、写入和清空文本剪贴板，也可从本地 PNG 写入图片剪贴板。
- `desktop.keychain`：按应用 bundle identifier 隔离的 UTF-8 私有键值。

## 窗口资源

`desktop.windows.create(options)` 要求稳定的字符串 `id`；如果 Host 已有同 ID 窗口，则接管并
更新它。一个 Desktop session 内，同 ID 始终返回同一个 handle。窗口关闭后旧 handle 的调用会以
`HostError("UNSAFE_STATE")` 失败；再次 create 会产生新 handle。`get(id)` 和 `list()` 会先
刷新 Host 列表，`refresh()` 则刷新单个 handle 的不可变状态快照。

`BrowserWindow` 的 mutation 都是异步方法并返回 `Promise<void>`：
`navigate/show/hide/focus/close/minimize/maximize/restore/setFullScreen`，
以及 `setTitle/setSize/setMinimumSize/setPosition/setCloseBehavior/setAlwaysOnTop`、
`setVisibleOnAllSpaces/setVisibleOverFullScreen`。成功 response 和 Host event 都会更新同步只读的
`state`；状态实际变化时派发 `change`，关闭时派发一次 `close`。

`create` 的 `style` 支持 `native`、`overlay` 和 `frameless`，默认使用 `native`。`overlay` 保留
macOS 原生红黄绿按钮并让 WebView 延伸至标题栏区域；Host 隐藏原生标题文字和背景，但不移动
系统按钮，也不向页面注入安全区。`frameless` 创建完全无系统装饰的窗口，并且是唯一允许
`transparent` 的样式。

`overlay` 和 `frameless` 都可以配置顶部原生 `dragRegion`，`shadow` 与 `resizable` 也在创建时
确定。这些外观字段创建后不可更改；同 ID 接管时省略字段会保留原值，传入冲突值会返回
`INVALID_ARGUMENT`。透明窗口还需要页面 CSS 将 `html`/`body` 背景设为透明。拖动带拦截覆盖
区域内的网页左键交互，可用左右 inset 为页面控件留出区域；系统红黄绿按钮始终从命中区排除。

默认窗口为 1024×700、最小 720×480、关闭时隐藏并恢复按 ID 保存的位置。`x/y` 使用以主屏
左上角为原点、向右/向下递增的逻辑点坐标，多屏可以出现负值；`state.frame` 返回实际窗口外框。
`restore` 同时解除最小化和最大化，退出全屏应显式调用 `setFullScreen(false)`。不可缩放窗口
调用 `maximize()` 会返回 `INVALID_ARGUMENT`。

Backend 可加载任意 HTTP(S) URL，但 WebView 没有 script message handler；用户点击的跨 origin
主框架链接交给系统浏览器。FIA 不提供页面 bindings、`executeJs()` 或同步原生 setter。

## Tray、Dock 与事件

Tray 是 Host 预创建的单例，不支持构造、销毁、多个 Tray 或 panel attachment；`statusBar` 配置
继续负责 Starting/Failure fallback。Dock 和 Tray 不能同时隐藏，以保证故障后仍有恢复入口。

菜单使用固定 tagged union：

```ts
await desktop.tray.setMenu([
  { item: { id: "open", label: "Open", accelerator: "CmdOrCtrl+O" } },
  "separator",
  {
    submenu: {
      id: "tools",
      label: "Tools",
      items: [{ item: { id: "capture", label: "Capture", enabled: true } }],
    },
  },
]);
```

菜单最多 8 层/256 节点；所有 item/submenu ID 必须全树唯一且不能使用保留的 `fia.*`，Quit 始终
由 Host 追加。`accelerator` 接受 `CmdOrCtrl|Cmd|Command`、`Ctrl|Control`、
`Alt|Option`、`Shift` 加一个字符或 `Space`；重复 modifier、未知 token 和缺少按键会被拒绝。

Tray 使用 `click`、`menuclick`，Dock 使用 `reopen`，通知使用 `click`，全局快捷键使用
`pressed`。所有事件都通过类型化 `addEventListener` 注册。在 HMR/stop 开始时 FIA 先停止旧
definition 的事件投递，但 `stop({ desktop })` 返回前仍可执行异步清理命令；之后整个 session
及其 handle 都会失效。全局快捷键也会在 definition 切换和启动失败时清空。

## 其他能力约束

通知不会在 `send` 时隐式申请权限；应用应在合适的用户操作后调用 `requestAuthorization`。
通知点击会在 Backend 启动或重启期间排队，ready 后按顺序投递。

文件面板支持标题、初始目录、扩展名过滤、多选、隐藏文件、建议保存文件名和新建目录控制。
用户取消返回 `null`；打开面板即使只允许单选也统一返回路径数组。FIA 是非沙盒应用，不创建
security-scoped bookmark。

Keychain 的 service 固定为 bundle identifier，key 作为 account；值使用
`afterFirstUnlockThisDeviceOnly`，不支持列举、整库清空或跨应用 service。剪贴板图片只接受
可解码的本地 PNG，也可直接接受当前 Desktop session 的 `CapturedImage`。

全局快捷键使用按 ID 的原子全量集合：`set([])` 清空，重复组合、无修饰键、超出白名单或系统
冲突会使整批失败并保留旧集合。快捷键在 Backend/HMR 生命周期切换时清理。

`screens.list` 和窗口坐标统一使用主屏左上角为原点的逻辑点。截图区域使用目标屏幕左上角为
原点的逻辑点，必须完全落在该屏幕内；结果固定为 PNG，并由 FIA 写入 Backend Application
Support 下按 Desktop session 隔离的临时目录。stdio 只返回路径、大小和像素尺寸，图片字节不会
进入 1 MiB 帧。`CapturedImage` 以文件支持的 `file`/`stream()` 延迟读取，可用 `saveTo()`
持久化，并应在使用结束后调用幂等 `dispose()`；每个 session 最多保留 128 个、合计 512 MiB
的未释放截图，session 停止时会统一清理。传入 `stream({ dispose: true })` 可在流结束、失败或
取消时自动释放。首次授权可能需要重启应用才能捕获。
当前 macOS 14–26 不由 FIA 注入 `NSScreenCaptureUsageDescription`；授权与重启流程参考
[Apple ScreenCaptureKit macOS 示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)。

本地路径操作要求无 NUL、绝对且存在的 POSIX 路径。`trashPath` 只使用系统废纸篓并返回实际
落点，不提供永久删除。

所有 Promise 型 Desktop 方法接受可选的 `{ signal }` 尾参数。普通调用保持 30 秒超时，文件
面板、通知授权和屏幕录制授权无固定超时；取消文件面板会关闭对应的原生面板。
