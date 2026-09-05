# 原生能力重构迁移

本次是未发布的破坏性 API 调整。macOS 14 / Swift 6、fia.toml schema 2、Bun stdio v3 不变；框架和客户端须一起升级。Xhub 不在本次修改范围。

## 生命周期

默认红色按钮关闭窗口，最后窗口关闭后应用继续运行，Dock 恢复主窗口。状态栏图标不再决定是否退出。恢复旧退出策略：

```swift
runtime.lastWindowClosedAction = .quit
```

工作台可使用 `registerAppKit("main", userCloseAction: .hideApplication) { ... }`。所有注册入口均支持 `userCloseAction`；隐藏窗口可选 `.hideWindow`。`windows.close` 是实际关闭，用户关闭策略只作用于标准按钮与 `performClose`。默认菜单的 ⌘W 使用该路径；应用仍能用 `customizeMenu` 将它替换为关闭标签。

`runtime.reopenAction` 默认 `.restoreMainWindow`，可设 `.none`。`runtime.windows.mainWindowID` 显式指定主窗口；否则选 `main`，再按注册顺序选首个窗口。恢复会取消应用隐藏、恢复最小化、激活窗口；已关闭的注册窗口重新创建。

`onShutdown(name:timeout:_:)` 接收可抛错的 MainActor 异步回调，默认每个回调 10 秒，逆序执行。更新和 Quit 共用完整清理任务，首次原因固定。Runtime 先拒绝新 RPC、取消在途请求，再运行回调。因此回调不能再通过 Native RPC 做清理，应使用直接 Swift 引用。

回调抛错或超时记录于 `runtime.shutdownReport.issues` 并继续。超时只请求取消，不强杀 Swift Task；忽略取消的回调可能迟到，不能阻塞 MainActor、递归等待 Runtime 关闭或启动新服务。

`lifecycle` 为 `running / shuttingDown / stopped`。关闭开始后禁止注册回调、恢复受管窗口和通过 Runtime 启动进程。`customizeMenu` 只允许配置阶段注册，标准菜单安装后按顺序调用一次，headless 不执行。

受管进程停止失败会保持 `shuttingDown`，取消本次 Quit 或阻止更新。再次 Quit 重试失败步骤；更新清理失败后再次执行 Check for Updates 重试已挂起的安装。回调不重跑，不恢复 RPC。成功清理才进入 `stopped`。

异步代码请求退出应使用 `FIAApplication.requestQuit()`，由主 RunLoop 发起退出。直接从 Swift Task 或主 DispatchQueue 调用 `NSApp.terminate` 可能阻塞 AppKit 的嵌套退出循环，导致 MainActor 清理无法执行。菜单的标准 Quit 不受影响。

## 无协议进程

```swift
let service = ManagedProcess(
    executable: URL(fileURLWithPath: "/path/to/service"),
    arguments: ["serve"]
)
try runtime.startProcess(service)
runtime.onShutdown(name: "service") {
    try await service.stop {
        try? service.write(Data("quit\n".utf8))
    }
}
```

`runtime.startProcess` 登记所有权：即使回调超时/失败，Runtime 仍会确认该进程停止。独立使用 `ManagedProcess.start()` 时，调用者自行持有并 `await stop()`。实例只能启动一次；重启创建新实例。

每个实例拥有独立进程组。停止依次等待 5 秒、SIGTERM 后 2 秒、SIGKILL 后 2 秒；成功意味着直接子进程已回收且进程组不存在。停止失败可重试；不支持逃离进程组的守护进程或跨应用重启的 PID 清理。

`stdout`、`stderr` 各保留最近 1 MiB，可调整 `logLimit`。`output()` 是保留最近 128 块的诊断流；`onOutput` 是有序无丢失回调，使用管道反压，回调应快速返回。stdin 按完整数据块进入最多 4 MiB 的有界串行队列；入队失败同步抛错，操作系统写入失败通过 `onInputError` 通知，不阻塞 MainActor。HTTP 就绪、服务发现和产品重启策略由调用者负责。Bun 在此层之上保留校验、协议、就绪和退避，不再提供同步 Bool 型 `stop()`。

## 窗口状态与事件

删除 `visibility` 和旧事件枚举。`AppWindowState` / `windows.state` 现在包含：

| 字段              | 含义                                                           |
| ----------------- | -------------------------------------------------------------- |
| lifecycle         | registered：尚未实例化；open：已实例化且未关闭；closed：已关闭 |
| orderedIn         | 未关闭且 AppKit `isVisible` 为真，不保证未被遮挡               |
| applicationHidden | 应用当前隐藏状态                                               |
| miniaturized      | 窗口最小化状态                                                 |
| focused           | 未关闭、应用活跃且未隐藏、窗口为 key window                    |
| fullscreen        | windowed / entering / fullscreen / exiting                     |

`id`、`kind` 保留。隐藏、最小化、应用隐藏均不等于 closed。查询不创建或恢复窗口。Swift 事件与 `windows.changed` 统一为 `{ previous, current, cause }`，实际状态不变时不发送。客户端应使用 `current` 替换状态，不应再读取旧的 `event/window` 载荷。`fia describe` 提供新的 `windowContract` 描述。

框架拥有 NSWindow delegate。应用使用类型化关闭策略及事件观察；不要替换 delegate 或重绑标准窗口按钮。

## Web 内容

- `registerWeb` 改为 `registerFIAWeb`，仍接受可信 `route`。RPC `windows.createWeb` 保持可信路由限定。
- 外部窗口使用 `registerExternalWeb(id:url:title:dataStore:userCloseAction:)`，不启动 Gateway。
- 嵌入外部内容使用 `ExternalWebContent`，AppKit 将 `content.webView` 加入视图树，SwiftUI 使用 `WebContentView(content)`；内容对象由应用持有。
- 可信嵌入内容使用 `runtime.windows.makeFIAContent(route:)`，在 Gateway 启动后调用，例如注册窗口的 factory 内。`WebWindow` 接收 `content`，不再负责创建 WebKit 配置。
- 外部数据策略为 `.ephemeral`（默认）、`.persistent(UUID)`、`.sharedDefault`。同 UUID 共享跨重启数据，不同 UUID 隔离；可信内容固定独立非持久化存储。
- `navigationPolicy` 可收紧导航；`onExternalLink` 接收被拦截的链接。可信内容只能留在 Gateway/开发源，回调不能扩大信任范围。
- `onPopup` 只用于外部内容，应用负责返回视图及其 UI；可信弹窗不继承会话。没有处理器时取消。
- `downloadDestination` 返回本地文件 URL，没有目标时取消。`onDownloadFinished` 和 `onError` 用于应用反馈。

移除默认的私有 WebKit rubber-banding selector，采用系统滚动行为。应用不应依赖之前的弹性滚动设置。

## 示例与验证

运行 `swift run FIAWorkbenchExample`，参考 `examples/native-workbench/README.md`。标题栏标签留在示例中，不是框架稳定组件。

`fia check` 仍做配置/生成代码静态检查；`fia test` 已运行应用 Swift 测试。框架仓库 `bun run check` 执行完整检查；`python3 tools/smoke-native-workbench.py` 验证 release .app 启动、窗口与服务就绪、普通 Quit 和进程组退出。动画及 macOS 14 需要独立桌面验收，见 `native-refactor-verification.md`。
