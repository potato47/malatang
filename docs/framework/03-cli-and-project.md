# CLI 与项目

## 命令

- `fia create <name>`：生成必选 Bun Backend 和 React HTTP/WS 示例。
- `fia dev`：创建临时开发 App，由 Host 以 `bun --hot` 启动 Backend。Backend runner 使用项目内
  稳定路径，使 Host 与配置未变化时重复启动的 ad-hoc App 保持同一代码身份，避免仅因会话目录
  变化而丢失 TCC 授权。
  - `--print-session-url` 在首次启动时输出带 `FIA_DEV_SESSION_URL=` 标记的 30 秒单次会话 URL。
  - `--emit-action <id>` 在首次 ready 后通过真实 Host 事件链路触发一个可点击菜单项。
- `fia run`：构建临时生产 App 并启动。
- `fia build`：生成 `dist/<App>.app`。
- `fia package`：使用 Developer ID、Hardened Runtime 与安全时间戳生成待验证/公证 ZIP。
- `fia release`：公证并 staple App，执行 Gatekeeper 验证，生成最终 ZIP 与 SHA-256。
- `fia doctor`：检查 macOS、arm64、Bun、签名与可选 Swift 工具链。

## 配置

`fia.config.ts` 使用 `configVersion: 6`，只允许 `configVersion`、`app`、`backend`、`host`、
`helpers`、`statusBar`、`signing`、`release`。Backend `entry` 必须是项目内可读文件；`watch`
默认是 entry 所在目录。所有未知字段和旧版本立即失败。

`host` 可指定一个项目内已构建的自定义 arm64 Mach-O；`helpers` 最多 32 个，按安全且唯一的
目标名称复制到 App。所有路径必须留在项目 realpath 内并具有读/执行权限；`FIABackend` 是
保留 helper 名称。未配置 `host` 时使用 FIA 随 CLI 发布的预编译 Host。

`signing.identity` 是可选的精确 codesigning identity 名称，只接受有效的 Apple Development 或
Developer ID Application identity，并同时用于 Backend、额外 helpers、Host 与顶层 App。省略时继续 ad-hoc
签名；CLI 会提示此模式下屏幕录制等 TCC 授权可能在重建后需要重新授予。该字段不启用 hardened
runtime、公证或发布流程。

`release.identity` 只接受 Developer ID Application identity。`fia package` 按 Backend、按名称
排序的 helpers、Host、App 顺序进行明确的 inside-out 发布签名；只有 Backend 具有最小 JIT
entitlement。`fia release` 还要求
`release.notarization.keychainProfile`，该字段是 `notarytool store-credentials` 创建的钥匙串
profile 名称，不存储 Apple 凭据。

```bash
xcrun notarytool store-credentials "fia-notary" \
  --apple-id "you@example.com" \
  --team-id "TEAMID"
```

背景参考：[Apple：为 Mac 创建分发签名代码](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)。

项目的 `backend/index.ts` 默认导出 `defineBackend<SocketData>()({...})`；不使用 WebSocket data 时写
`defineBackend()({...})`。React 只是模板选择，运行时不引用 React，
应用也可换成其他前端或只提供 API。

默认模板将 Backend 与前端分别放在根级 `backend/` 和 `frontend/`。前端仅包含 React、
Tailwind CSS 和 HTTP/WebSocket 示例，不提供 FIA 组件库或设计系统；应用自行维护 UI 技术栈。

受保护的 route 和 fallback `fetch` handler 第三个参数提供 `{ desktop, app }`。`app` 包含 Host
权威的 name、identifier 和预先创建的绝对 `dataDirectory`，无需复制配置或依赖 `cwd()`。

开发模式使用稳定 Bun server ID 热替换 routes/handlers，并复用同一 stdio peer；前端 HTML
imports 使用 Bun full-stack HMR。
