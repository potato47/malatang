# FIA 2.0 框架契约

> 当前边界：项目 schema 2、Native RPC protocol 1、可选 Bun stdio protocol 3。

## 架构

应用自己的 `FIAAppExecutable` 是唯一入口。`FIAApplication.run` 创建 `FIARuntime`，应用在闭包中
注册 SwiftUI、AppKit、Web 窗口及自定义 Native 方法。Swift 本地调用服务不走 RPC；WKWebView、
Browser Companion 和 Bun 经不同 transport 进入同一 typed dispatcher。

窗口由 `WindowManager` 统一管理 `show/hide/focus/close`、状态和事件。Web/Bun 可以打开已注册
窗口；仅 Web 能动态创建 WebWindow。Browser Companion 协商能力，窗口能力默认返回
`capability_unavailable`。

## 项目模型

`fia.toml` 只允许 `[app]`、`[web]`、`[backend]`、`[statusItem]`、`[native.permissions]`、
`[updater]`/`[updater.feeds]` 和 `[signing]`。窗口不进入 TOML，Swift 注册是唯一真源。

`native-api/api.fia.json` 使用 JSON Schema Draft 2020-12。`fia generate` 生成纳入版本控制的 Swift
和 TypeScript 源码；生成的 `createAppNativeAPI(transport)` 可同时接入浏览器 `native` 与 Bun
`context.native`。`generate --check` 与 `fia check` 拒绝漂移。

## Gateway 与安全

仅在 Web、Browser Companion 或 Bun 需要时绑定随机 `127.0.0.1` 端口，提供：

- `/_fia/bootstrap`：30 秒、一次性 bootstrap；
- `/_fia/native`：WebSocket Native RPC；
- `/_fia/resources/:id`：session 隔离的临时二进制资源；
- `/_fia/health`：本机健康检查；
- `/api/*`：代理给可选 Bun Backend。

Gateway 使用 256-bit session、HttpOnly SameSite cookie、精确 Host/Origin、受限请求体和一次性链接。
NativeResource 使用临时文件、10 分钟 TTL、session 清理和 128 项/512 MiB 配额；浏览器通过 Vite
服务端代理读取，Bun 则使用 protocol v3 下发的本机资源会话，凭据都不会进入页面脚本。

## 生命周期

普通应用默认使用 Dock、标准菜单与主窗口。状态栏只有配置 `[statusItem]` 才创建。Bun 启动失败或
崩溃只更新服务状态并退避重启，不关闭原生窗口。更新前停止长操作、通知并停止 Bun、取消/清理
NativeResource，然后由 Sparkle 替换整个 `.app` 并 relaunch。

`fia dev --browser chrome|edge` 以隐藏 accessory Runtime 驱动 Browser Companion；只有同时传入
`--app` 才显示 Dock 和原生窗口。Pure Native 项目不会启动 Gateway，也不接受 Browser Companion。

## 构建与发布

FIA 面向 macOS 14+、Apple Silicon arm64、Swift 6。源码包精确锁定 SwiftNIO 2.97.1 和
Sparkle 2.9.6。`build` 仅包含启用的 Web assets、Bun helper 和 Sparkle framework；`release`
使用 Developer ID、notarytool、staple 与 Gatekeeper，生成 full update，不实现 delta 或上传。

FIA 2.0 不保留 1.x 配置/API/协议、预编译 Host、Mac App Store、跨平台或远程 Native RPC。

## 应用扩展点

应用可在 `FIAApplication.run` 的配置闭包内调用：

- `runtime.onShutdown { ... }`：注册 `@MainActor` 异步清理，在应用退出或更新前等待执行。
  按注册的逆序执行；更新和退出并发或重复触发时共享同一个清理任务，每个处理器只运行一次。
  处理器应自行限制 I/O 等待时间，不应递归触发或等待 Runtime 关闭；关闭开始后禁止注册新处理器。
- `runtime.customizeMenu { menu in ... }`：在标准菜单安装后修改菜单，支持应用自定义快捷键
  （例如将 Command-W 从关闭窗口改为关闭标签）。无界面模式不会安装或定制菜单。

这些扩展无需替换 FIA 的 `NSApplicationDelegate`。
