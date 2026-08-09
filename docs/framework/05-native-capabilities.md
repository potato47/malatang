# Host 原生能力

原生能力只通过 `defineBackend` 上下文中的 `host` 暴露，浏览器 bundle 没有对应导出。

- `host.application`：读取 Dock/状态栏可见性、退出、切换 Dock。
- `host.statusItem`：可见性、SF Symbol、tooltip、完整动态菜单、左键与 action 事件。
- `host.webviews`：按 ID open/upsert、navigate、show/hide/focus/close/update/list 和状态事件。
- `host.system.openURL`：通过系统默认浏览器打开 HTTP(S) URL。

菜单最多 8 层/256 节点，支持 separator、enabled、hidden、checked、SF Symbol、快捷键和
子菜单；`fia.*` ID 保留，Quit 始终由 Host 追加。

WebView 默认 1024×700、最小 720×480、关闭时隐藏并恢复按 ID 保存的位置。Backend 可加载
任意 HTTP(S) URL，但 WebView 没有 script message handler；用户点击的跨 origin 主框架链接
交给系统浏览器。

Dock 和状态栏不能同时隐藏，以保证故障后仍有恢复入口。
