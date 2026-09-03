# FIA 实施状态

## 常驻 Bun Backend 基线

- [x] 公共配置升级为 `configVersion: 6`，Backend 必选，支持严格校验的 custom Host/helpers，并拒绝全部旧 UI/MCP 字段。
- [x] `defineBackend` 管理标准 HTTP routes、WebSocket、启动/停止钩子和 Backend-only Host API。
- [x] loopback 服务使用一次性 bootstrap、HttpOnly SameSite 会话、Host/Origin 校验。
- [x] Swift Host 升级为 schema 8 和 stdio protocol 2，启动即监管唯一 Backend。
- [x] 状态栏支持层级、分隔线、状态、SF Symbol、快捷键和动态更新。
- [x] WebView 按 ID 多窗口管理，支持导航、显示策略和窗口位置恢复。
- [x] Backend 崩溃退避重启，耗尽后提供 Retry/Quit 故障菜单。
- [x] 生产使用 Bun full-stack standalone Helper，inside-out 签名并记录签名后 SHA-256。
- [x] React 模板只通过标准 HTTP/WebSocket 与 Backend 通信。
- [x] 删除浏览器原生桥、MCP Router、外部 MCP Server 和 UI-only 模式。

## 后续增强

- [x] 为 Host 请求增加可选 AbortSignal/取消帧。
- [x] 增加通知、文件面板、文本剪贴板和 Keychain 等 Backend-only 原生能力。
- [x] 增加全局快捷键、屏幕枚举/截图、Finder 路径操作和 PNG 剪贴板能力。
- [x] 默认示例应用已移出仓库；框架能力改在独立的实际项目中进行端到端验收。
- [x] 增加可选稳定开发签名 identity；缺省仍使用 ad-hoc 签名。
- [x] 实现 arm64 Developer ID、Hardened Runtime、notarization、stapling 与 ZIP 发布命令。
- [ ] 使用真实 Developer ID 与 Apple 公证服务完成发布链路端到端验收。
- [ ] 增加 universal binary、DMG、发布 CI 与自动更新流程。
- [ ] 增加长期运行、休眠唤醒和网络切换压力测试。
