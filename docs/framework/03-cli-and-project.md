# CLI 与项目

## 命令

- `fia create <name>`：生成必选 Bun Backend 和 React HTTP/WS 示例。
- `fia dev`：创建临时开发 App，由 Host 以 `bun --hot` 启动 Backend。
- `fia run`：构建临时生产 App 并启动。
- `fia build`：生成 `dist/<App>.app`。
- `fia doctor`：检查 macOS、arm64、Bun、签名与可选 Swift 工具链。

## 配置

`fia.config.ts` 只允许 `configVersion`、`app`、`backend`、`statusBar`。Backend `entry` 必须是
项目内可读文件；`watch` 默认是 entry 所在目录。所有未知字段和旧版本立即失败。

项目的 `src/backend.ts` 默认导出 `defineBackend`。React 只是模板选择，运行时不引用 React，
应用也可换成其他前端或只提供 API。

开发模式使用稳定 Bun server ID 热替换 routes/handlers，并复用同一 stdio peer；前端 HTML
imports 使用 Bun full-stack HMR。
