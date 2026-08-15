# Host 原生能力

原生能力只通过 `defineBackend` 上下文中的 `host` 暴露，浏览器 bundle 没有对应导出。
生命周期上下文以及受保护 route/fetch 的第三参数同时提供 `app`；其中 `dataDirectory` 是 Host
预先创建并通过 initialize 帧传入的绝对持久化目录。

- `host.application`：读取 Dock/状态栏可见性、退出、切换 Dock，以及接收 reopen 事件。
- `host.statusItem`：可见性、SF Symbol、tooltip、完整动态菜单、左键与 action 事件。
- `host.webviews`：按 ID open/upsert、navigate、show/hide/focus/close/update/list 和状态事件。
- `host.globalShortcuts`：原子替换最多 32 个系统全局快捷键，并接收 pressed 事件。
- `host.screens`：枚举显示器、逻辑坐标、可见区域、缩放、主屏与鼠标所在屏。
- `host.screenCapture`：显式读取/申请屏幕录制授权，并把单屏或屏内区域捕获为 PNG 文件。
- `host.system`：打开 HTTP(S) URL 或本地路径、在 Finder 定位路径、把路径移入废纸篓。
- `host.notifications`：读取/申请授权、发送和移除通知，以及通知点击事件。
- `host.dialogs`：打开文件、打开目录和保存文件面板，结果为绝对 POSIX 路径。
- `host.clipboard`：读取、写入和清空文本剪贴板，也可从本地 PNG 写入图片剪贴板。
- `host.keychain`：按应用 bundle identifier 隔离的 UTF-8 私有键值。

菜单最多 8 层/256 节点，支持 separator、enabled、hidden、checked、SF Symbol、快捷键和
子菜单；`fia.*` ID 保留，Quit 始终由 Host 追加。

WebView 默认 1024×700、最小 720×480、关闭时隐藏并恢复按 ID 保存的位置。Backend 可加载
任意 HTTP(S) URL，但 WebView 没有 script message handler；用户点击的跨 origin 主框架链接
交给系统浏览器。

`webviews.open` 可用 `windowStyle: "borderless"` 创建完全无系统装饰的窗口，并在创建时配置
`transparent`、`shadow`、`resizable` 和顶部原生 `dragRegion`。这些外观字段创建后不可更改；
同 ID upsert 省略字段会保留原值，传入不同值会返回 `INVALID_ARGUMENT`。透明窗口还需要页面
CSS 将 `html`/`body` 背景设为透明。拖动带拦截覆盖区域内的网页左键交互，可用左右 inset
为页面按钮留出区域。

窗口打开后可通过 `minimize`、`maximize`、`restore` 和 `setFullScreen` 控制原生窗口状态。
`restore` 同时解除最小化和最大化；退出全屏应显式调用 `setFullScreen(id, false)`。不可缩放窗口
调用 `maximize` 会返回 `INVALID_ARGUMENT`。`FIAWebViewState` 的 `minimized`、`maximized` 和
`fullScreen` 表示 Host 当前观察到的原生状态；全屏切换包含系统动画，最终状态也会通过
`host.webviews.onEvent` 的 `changed` 事件发布。最大化和全屏帧不会覆盖按窗口 ID 持久化的普通帧。

`open` 和 `update` 的 `x/y` 使用以主屏左上角为原点、向右/向下递增的逻辑点坐标，多屏可以
出现负值。状态中的 `frame` 返回实际窗口外框；原生标题栏窗口的外框尺寸可能大于传入的内容
`width/height`。显式坐标允许位于屏幕外，只有历史恢复位置会被约束到可见屏幕。

Dock 和状态栏不能同时隐藏，以保证故障后仍有恢复入口。

通知不会在 `send` 时隐式申请权限；应用应在合适的用户操作后调用
`requestAuthorization`。通知点击会在 Backend 启动或重启期间排队，ready 后按顺序投递。

文件面板支持标题、初始目录、扩展名过滤、多选、隐藏文件、建议保存文件名和新建目录控制。
用户取消返回 `null`；打开面板即使只允许单选也统一返回路径数组。FIA 是非沙盒应用，不创建
security-scoped bookmark。

Keychain 的 service 固定为 bundle identifier，key 作为 account；值使用
`afterFirstUnlockThisDeviceOnly`，不支持列举、整库清空或跨应用 service。剪贴板图片首版只接受
可解码的本地 PNG。

全局快捷键使用按 ID 的原子全量集合：`set([])` 清空，重复组合、无修饰键、超出白名单或系统
冲突会使整批失败并保留旧集合。快捷键在 Backend/HMR 生命周期切换时清理。

`screens.list` 和 WebView 坐标统一使用主屏左上角为原点的逻辑点。截图区域使用目标屏幕左上角
为原点的逻辑点，必须完全落在该屏幕内；结果固定为 PNG，并写到 Backend Application Support
目录中尚不存在的目标。图片字节不会进入 1 MiB stdio 帧。首次授权可能需要重启应用才能捕获。
当前 macOS 14–26 不由 FIA 注入 `NSScreenCaptureUsageDescription`；授权与重启流程参考
[Apple ScreenCaptureKit macOS 示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)。

本地路径操作要求无 NUL、绝对且存在的 POSIX 路径。`trashPath` 只使用系统废纸篓并返回实际
落点，不提供永久删除。`clipboard.writeImage` 首版只接受可解码的 PNG。

所有 Promise 型 Host 方法接受可选的 `{ signal }` 尾参数。普通调用保持 30 秒超时，文件面板、
通知授权和屏幕录制授权无固定超时；取消文件面板会关闭对应的原生面板。
