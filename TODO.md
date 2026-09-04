# FIA 2.0 实施状态

## 核心闭环

- [x] Swift-owned `FIAAppExecutable`、源码 SwiftPM Runtime 和普通 macOS GUI 生命周期。
- [x] SwiftUI、AppKit、WKWebView 统一窗口状态、事件、恢复与 Native RPC 操作。
- [x] 严格 `fia.toml` schema 2，以及 Native/Web/Hybrid × 可选 Bun 六种模板。
- [x] Browser Companion、Vite 服务端凭据代理和按需 loopback Gateway。
- [x] Bun stdio protocol v3、崩溃退避、取消/超时及不影响原生窗口的故障隔离。
- [x] Draft 2020-12 Native API schema、确定性 Swift/TypeScript codegen 与漂移检查。
- [x] NativeResource 临时文件、10 分钟 TTL、session 隔离、流式读取与配额。
- [x] AppKit 交互式区域截图，以及剪贴板、对话框、Keychain、通知、屏幕、系统和快捷键服务。
- [x] Sparkle 2.9.6 按需 provider、完整更新前退出序列和 full-update release 产物。
- [x] `create/dev/run/generate/check/test/describe/build/release/doctor` 命令集及机器可读输出。
- [x] 删除 1.x 配置、协议、预编译 Host、custom Host shim 和 `package` 流程。

## 发布前外部验收

- [ ] 使用两个真实 Developer ID 版本完成签名、公证、2.0.n → 2.0.n+1 更新及 relaunch 验收。
- [ ] 在真实 TCC 环境验证区域截图授权、取消、多显示器和 WKWebView/Browser Companion 交互。
- [ ] 完成长时间运行、休眠唤醒、Bun 反复崩溃与网络切换压力测试。
