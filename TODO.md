# FIA 开发 TODO

- 最后更新：2026-07-29
- 当前基线：`@semicoder/fia` 0.5.0，MCP `2026-07-28` modern-only
- 当前架构：静态 Web UI + Swift Host + Native MCP + stdio MCP Servers

## 0.5 重构完成项

### 公共模型与脚手架

- [x] 公共配置升级为 `configVersion: 3`，严格拒绝未知字段和所有旧 Runtime/Backend 字段。
- [x] `mcp` 支持 UI-only、单一 Bun `app` entry 和多个预构建 executable。
- [x] 校验保留 ID、ID 格式、目录穿越、符号链接越界和执行权限。
- [x] 新增 `@semicoder/fia/mcp`、`@semicoder/fia/mcp/server`。
- [x] `@semicoder/fia/native` 改为 `fia.native` MCP typed facade。
- [x] 默认 React 模板生成 Bun MCP greet Server；新增 `fia create --no-mcp`。
- [x] 删除 `--runtime`、旧 runtime/backend exports、Swift Backend SDK 和模板。

### Host 与协议

- [x] Host 配置升级为 schema 5，manifest 声明 bridge 1 和 MCP `2026-07-28`。
- [x] WebKit transport 保持 MCP JSON-RPC 原文并执行精确 origin/main-frame 校验。
- [x] 实现进程内 `fia.native` tools/resources/subscriptions。
- [x] 实现按 server ID 路由的 stdio Supervisor。
- [x] 实现延迟启动、专属工作目录、stdout framing、stderr 日志和消息/并发限制。
- [x] 实现崩溃关闭、按需重启、页面会话重置和全量进程回收。
- [x] 删除旧 Runtime/Backend Supervisor 和协议。

### 开发、构建与分发

- [x] UI 开发使用 Bun HTML/HMR，Host 只加载精确 localhost origin。
- [x] UI 生产打包为 `Contents/Resources/UI`。
- [x] `app` 开发直接运行生成的 Bun stdio runner。
- [x] `app` 生产使用 Bun standalone arm64 编译，无外部 Bun 依赖。
- [x] watch 变更通过 dev-only Host 控制通道只重启目标 Server。
- [x] 构建执行 modern discover/tools 冒烟验证。
- [x] 固定 `Contents/Helpers/MCPServers` 布局。
- [x] 实现 Server → Host → App 签名、签名后 SHA-256 和严格验证。
- [x] npm 发布文件收敛到 `bin`、`dist`、`templates`、`assets` 和 README。

### 测试与文档

- [x] 配置、模板、generated runner、MCP facade、Native facade 和生产布局测试。
- [x] Host 配置、bridge、origin、窗口行为和 Native 命令测试。
- [x] 默认模板 production app Server standalone 冒烟测试。
- [x] 重写 README、架构、安全、生命周期、ADR 与发布清单。
- [ ] 在独立 GUI 会话执行默认项目 `create → dev → run → build` 手工验收。
- [ ] 执行 Command-Q、CLI 中断、Host 崩溃和 Server 崩溃的真实进程残留验收。

## 下一阶段

### P0：发布工程

- [ ] 增加 Developer ID、hardened runtime 和最小 entitlement。
- [ ] 生成 ZIP/DMG，完成 notarization、staple 和 Gatekeeper 验证。
- [ ] 补齐 npm repository/homepage/bugs/license 与 `@semicoder` scope 发布权限。
- [ ] 在仓库外从 npm 安装并完成默认项目全流程。

### P1：Native MCP

- [ ] 文件、目录和保存面板。
- [ ] 通知与外部打开。
- [ ] Keychain namespace 和脱敏错误。
- [ ] 为 typed facade 完整映射 Native MCP 结构化错误代码。

### P1：可靠性与诊断

- [ ] 为 stdio Supervisor 增加更完整的真实子进程超时、崩溃和进程树测试。
- [ ] 为构建失败保留可选诊断目录和机器可读阶段信息。
- [ ] 提供 Server 状态、stderr 和 discover 结果的开发诊断面板。

### P2：平台化

- [ ] Universal Binary。
- [ ] 第三方 Server App Sandbox/XPC 隔离。
- [ ] 大文件、媒体和高频流旁路协议。
- [ ] 自动更新与回滚信任链。

## 合并门禁

```bash
bun install --frozen-lockfile
bun run check
```

- [ ] TypeScript 构建与 CLI 测试通过。
- [ ] Swift Host 测试通过。
- [ ] 无旧 runtime/backend 代码、导出或打包文件。
- [ ] 不放宽 origin、路径、签名、哈希或消息限制。
- [ ] 用户可见配置、协议和产物变化已更新文档。
