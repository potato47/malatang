# FIA 3 验收状态

已实现固定的预编译 Swift 宿主、Bun 后端和 WKWebView 架构；应用侧不需要 Swift 工程或编译工具。

- [x] 单一 React + Vite + TypeScript 模板和 `fia.config.ts`。
- [x] 预编译宿主、固定 Bun、校验清单、原生图标渲染和应用打包。
- [x] HTTP、业务 WebSocket、原生 RPC、取消、31 秒 SSE 和大资源文件传输。
- [x] 标准窗口、标题栏声明与动作、稳定多窗口和后端进程回收。
- [x] 真实双窗口开发会话的 React Fast Refresh 和 Bun 重启。
- [x] Ed25519 代码更新、兼容性校验、原生确认、持久化切换事务和失败回退。
- [x] 真实 Bun + WKWebView 更新：15 秒启动限时、30 秒观察、候选崩溃、前端未就绪和回退。
- [x] 清理模式、Swift 网关、Sparkle、应用侧代码生成器和旧模板。

发布前仍需在发布环境执行：

- [ ] 使用真实 Developer ID 和公证凭据完成签名、公证、Gatekeeper 与 Hardened Runtime 分发验证。
- [ ] 真实 TCC 授权、区域截图、多显示器、全屏和休眠唤醒的桌面验收。

运行 `bun run runtime:build && bun run cli:build && bun run check && bun run smoke` 复现本机自动化验收。
