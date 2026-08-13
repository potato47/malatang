# 路线图

## 当前基线

- config 5 / Host schema 8 / stdio protocol 2。
- 单一常驻 Bun Backend、HTTP/WS 和 secure bootstrap session。
- Backend-only application/statusItem/webviews/globalShortcuts/screens/screenCapture/system/
  notifications/dialogs/clipboard/keychain 能力。
- Host 异步请求、AbortSignal、取消帧和交互式调用无限等待。
- 多 WebView、完整动态菜单、退避恢复和 standalone 生产包。

## 下一阶段

- 结构化 diagnostics 和 Backend 健康指标。
- 完整 Developer ID 发布、notarization、universal binary 与自动更新。
- 睡眠/唤醒、长连接、WebContent 崩溃和长时间稳定性测试。

LAN 监听、浏览器原生桥、多个受 Host 监管的业务 Server 和旧 API 兼容不在路线图内。
