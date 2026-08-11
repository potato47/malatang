# Host 原生能力

原生能力只通过 `defineBackend` 上下文中的 `host` 暴露，浏览器 bundle 没有对应导出。
生命周期上下文以及受保护 route/fetch 的第三参数同时提供 `app`；其中 `dataDirectory` 是 Host
预先创建并通过 initialize 帧传入的绝对持久化目录。

- `host.application`：读取 Dock/状态栏可见性、退出、切换 Dock。
- `host.statusItem`：可见性、SF Symbol、tooltip、完整动态菜单、左键与 action 事件。
- `host.webviews`：按 ID open/upsert、navigate、show/hide/focus/close/update/list 和状态事件。
- `host.system.openURL`：通过系统默认浏览器打开 HTTP(S) URL。
- `host.notifications`：读取/申请授权、发送和移除通知，以及通知点击事件。
- `host.dialogs`：打开文件、打开目录和保存文件面板，结果为绝对 POSIX 路径。
- `host.clipboard`：读取、写入和清空文本剪贴板。
- `host.keychain`：按应用 bundle identifier 隔离的 UTF-8 私有键值。

菜单最多 8 层/256 节点，支持 separator、enabled、hidden、checked、SF Symbol、快捷键和
子菜单；`fia.*` ID 保留，Quit 始终由 Host 追加。

WebView 默认 1024×700、最小 720×480、关闭时隐藏并恢复按 ID 保存的位置。Backend 可加载
任意 HTTP(S) URL，但 WebView 没有 script message handler；用户点击的跨 origin 主框架链接
交给系统浏览器。

Dock 和状态栏不能同时隐藏，以保证故障后仍有恢复入口。

通知不会在 `send` 时隐式申请权限；应用应在合适的用户操作后调用
`requestAuthorization`。通知点击会在 Backend 启动或重启期间排队，ready 后按顺序投递。

文件面板支持标题、初始目录、扩展名过滤、多选、隐藏文件、建议保存文件名和新建目录控制。
用户取消返回 `null`；打开面板即使只允许单选也统一返回路径数组。FIA 是非沙盒应用，不创建
security-scoped bookmark。

Keychain 的 service 固定为 bundle identifier，key 作为 account；值使用
`afterFirstUnlockThisDeviceOnly`，不支持列举、整库清空或跨应用 service。剪贴板首版只处理文本。

所有 Promise 型 Host 方法接受可选的 `{ signal }` 尾参数。普通调用保持 30 秒超时，文件面板
和通知授权无固定超时；取消文件面板会关闭对应的原生面板。
