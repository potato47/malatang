# 路线图

## 0.5 MCP 单后端基线

- config v3 / Host schema 5 / MCP bridge 1。
- 静态 Web UI + Swift Host。
- `fia.native` 进程内 MCP Server。
- `app` Bun standalone MCP Server。
- 项目内预构建 stdio MCP Server。
- dev watch、按需启动、失败后按需重启和 facade 恢复。
- inside-out 签名、哈希和 modern discover 冒烟门禁。

## Native MCP 扩展

- 文件、目录与保存面板。
- 通知和外部打开。
- Keychain namespace 与脱敏错误。
- 全局快捷键、登录启动和应用数据迁移。

## 发布工程

- Developer ID 与 hardened runtime。
- ZIP/DMG、公证、staple 和 Gatekeeper。
- CI 产物清单和可复现构建元数据。
- 发布失败回滚与更新器信任模型。

## 平台化

- Universal Binary。
- Server 权限声明与可视化诊断。
- App Sandbox/XPC 隔离模型。
- 可选远程 MCP transport 与大数据旁路协议。

Windows/Linux Host、Mac App Store 兼容和多 WebView 浏览器产品能力没有承诺时间表。
