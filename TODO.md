# FIA 实施状态

## 常驻 Bun Backend 基线

- [x] 公共配置升级为 `configVersion: 4`，Backend 必选并拒绝全部旧 UI/MCP 字段。
- [x] `defineBackend` 管理标准 HTTP routes、WebSocket、启动/停止钩子和 Backend-only Host API。
- [x] loopback 服务使用一次性 bootstrap、HttpOnly SameSite 会话、Host/Origin 校验。
- [x] Swift Host 升级为 schema 6 和 stdio protocol 1，启动即监管唯一 Backend。
- [x] 状态栏支持层级、分隔线、状态、SF Symbol、快捷键和动态更新。
- [x] WebView 按 ID 多窗口管理，支持导航、显示策略和窗口位置恢复。
- [x] Backend 崩溃退避重启，耗尽后提供 Retry/Quit 故障菜单。
- [x] 生产使用 Bun full-stack standalone Helper，inside-out 签名并记录签名后 SHA-256。
- [x] React 模板只通过标准 HTTP/WebSocket 与 Backend 通信。
- [x] 删除浏览器原生桥、MCP Router、外部 MCP Server 和 UI-only 模式。

## 后续增强

- [ ] 为 Host 请求增加可选 AbortSignal/取消帧。
- [ ] 增加通知、文件面板、Keychain 等 Backend-only 原生能力。
- [ ] 增加 Developer ID、notarization 与 universal binary 发布流程。
- [ ] 增加长期运行、休眠唤醒和网络切换压力测试。
