# 原生能力重构验证记录

环境：2026-09-05，Apple Silicon，macOS 26.6.2，Swift 6 language mode，最低部署目标 macOS 14。没有 macOS 14 实机或虚拟机。

## 自动验证

`bun run check` 通过：CLI 78 项、Swift 53 项（29 项 XCTest + 24 项 Swift Testing），无失败或跳过。最后的焦点状态修正另行通过 FIATests 29 项回归。

- Swift 单元/集成测试：包含 Gateway 的 loopback 安全测试；受限沙箱首次运行会跳过这些用例，后续已在允许本地监听的环境重跑。
- 生命周期：更新/Quit 共享清理、回调逆序、抛错、超时、不响应取消与迟到结果、受管停止失败阻止完成、重试不重复回调、RPC/窗口在关闭阶段拒绝恢复。
- 进程：协议回归、并发停止、正常退出、忽略 SIGTERM、父进程先退出后的后代清理、所有权/信号失败与重试、输出洪泛与有界日志、输出 EOF、256 KiB stdin 背压、4 MiB 队列限额和启动失败。
- 窗口/Web：默认退出策略、标准菜单安装与 headless、隐藏式用户关闭与显式关闭、主窗口选择/重建、全屏失败恢复、可信导航边界、弹窗/下载策略、同 UUID cookie 共享与不同 UUID 隔离。
- `python3 tools/smoke-native-workbench.py`：release .app 两次独立启动均通过窗口/CLI 就绪、普通 Quit 和进程组消失检查；第二次启动确认 cookie 持久化，同源不同 UUID 无共享。输出位于 `.fia/smoke/`，未纳入版本控制。

Smoke 发现并修复了 Task/DispatchQueue 发起 `NSApp.terminate` 的嵌套运行循环阻塞。最终使用 `FIAApplication.requestQuit()` 从主 RunLoop 发起退出；该路径在生产 smoke 中验证。

## 桌面观察

当前系统实际检查了标签切换后的输入保留、深色主题、进入全屏后的内容与标签布局、Escape 退出全屏后的标题栏恢复，以及真实 ⌘Q 退出。红色按钮点击后内容仍存在；工具未能可靠读取 Dock，不能据此声称 Dock 点击恢复已做人工验收。

## 尚需外部验收

- macOS 14 上重复整个桌面矩阵与生产 smoke。
- 当前系统及 macOS 14：红色按钮隐藏、⌘H、最小化和 Dock 点击恢复的完整组合；跨应用失焦/恢复和多窗口订阅事件。
- 两种主题下连续全屏往返的全过程人工观察。单张截图及最终状态不能证明动画每一帧正确。
- 真实下载服务器与重定向、外部弹窗 UI、Sparkle 签名更新/失败重试的分发级验收。单元测试覆盖策略与清理契约，不等同于发布渠道验收。

`fia check` 仍是项目静态检查，`fia test` 运行应用 Swift 测试；框架 `bun run check` 是完整仓库检查。以上结果不能替代尚未执行的外部验收。
