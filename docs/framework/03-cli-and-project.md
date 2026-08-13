# CLI 与项目

## 命令

- `fia create <name>`：生成必选 Bun Backend 和 React HTTP/WS 示例。
- `fia dev`：创建临时开发 App，由 Host 以 `bun --hot` 启动 Backend。
  - `--print-session-url` 在首次启动时输出带 `FIA_DEV_SESSION_URL=` 标记的 30 秒单次会话 URL。
  - `--emit-action <id>` 在首次 ready 后通过真实 Host 事件链路触发一个可点击菜单项。
- `fia run`：构建临时生产 App 并启动。
- `fia build`：生成 `dist/<App>.app`。
- `fia doctor`：检查 macOS、arm64、Bun、签名与可选 Swift 工具链。

## 配置

`fia.config.ts` 只允许 `configVersion`、`app`、`backend`、`statusBar`、`signing`。Backend `entry`
必须是项目内可读文件；`watch` 默认是 entry 所在目录。所有未知字段和旧版本立即失败。

`signing.identity` 是可选的精确 codesigning identity 名称，只接受有效的 Apple Development 或
Developer ID Application identity，并同时用于 Backend helper 与顶层 App。省略时继续 ad-hoc
签名；CLI 会提示此模式下屏幕录制等 TCC 授权可能在重建后需要重新授予。该字段不启用 hardened
runtime、公证或发布流程。

背景参考：[Apple：为 Mac 创建分发签名代码](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)。

项目的 `src/backend.ts` 默认导出 `defineBackend<SocketData>()({...})`；不使用 WebSocket data 时写
`defineBackend()({...})`。React 只是模板选择，运行时不引用 React，
应用也可换成其他前端或只提供 API。

受保护的 route 和 fallback `fetch` handler 第三个参数提供 `{ host, app }`。`app` 包含 Host
权威的 name、identifier 和预先创建的绝对 `dataDirectory`，无需复制配置或依赖 `cwd()`。

开发模式使用稳定 Bun server ID 热替换 routes/handlers，并复用同一 stdio peer；前端 HTML
imports 使用 Bun full-stack HMR。
