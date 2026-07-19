# 构建、签名与发布

## 1. 构建输入

- `fia.config.ts`
- Bun server entry
- Web UI 和静态资源
- 预编译 Swift Host 或 `native/` SwiftPM package
- 图标、entitlements 和版本信息

## 2. 构建阶段

```text
validate
  ▼
typecheck / test
  ▼
bun build --compile
  ▼
select or build Swift Host
  ▼
assemble .app in staging
  ▼
sign nested code inside-out
  ▼
verify
  ▼
package ZIP/DMG
  ▼
notarize and staple
```

所有构建都在 `.fia/build/<build-id>/` staging 目录中进行，成功后原子移动到 `dist/`，避免留下半成品。

## 3. Bun 构建

首期：

```bash
bun build --compile \
  --target=bun-darwin-arm64 \
  src/server.ts \
  --outfile .fia/build/app-runtime
```

生产 runtime 包含：

- Bun runtime
- server code
- HTML/JS/CSS
- npm dependencies
- 被显式 import 的静态资源

构建前运行独立 TypeScript typecheck，因为 bundler 不替代完整类型检查。

## 4. Swift Host

默认从 CLI 的版本化内嵌资源提取预编译 Host。启用 native plugin 时执行：

```bash
swift build -c release
```

## npm 发布

npm 发布流程只从仓库根目录进入，避免误发布私有的 workspace 根包：

```bash
bun run release:npm --dry-run
bun run release:npm
```

预演和正式发布都会校验 CLI、包版本、arm64 Host manifest 与 SHA-256，并执行完整的
`bun run check`。正式发布还要求干净的 Git 工作树、有效的 npm 登录以及未使用过的版本，
最终通过 npm workspace 将 `@semicoder/fia` 公开发布到官方 registry。

内嵌 Host 附带 manifest，记录 CLI/Host 版本、arm64、macOS 14、内部配置 schema 和 Runtime
protocol，并在复制前校验 SHA-256 与 Mach-O 架构。`bun run host:package` 用当前 Host 源码
重新生成该资产。

## 5. `.app` 组装

必须生成或复制：

- `Contents/MacOS/FIAHost`
- `Contents/MacOS/fia-runtime`
- `Contents/Resources/fia-config.json`
- `Contents/Info.plist`

`Info.plist` 至少包含 bundle identifier、executable、display name、short version、build version
和 minimum system version。阶段 1 使用系统默认应用图标，自定义图标随后增加。

## 6. 架构

MVP 只输出 arm64。第二阶段支持：

- 单独 arm64/x64 应用
- 将两个 Host 和 Bun Mach-O slice 合并为 Universal Binary
- 对合并后的最终二进制重新签名

架构扩展前必须验证 Bun embedded assets 在 universal 合并后的完整性和启动行为。

## 7. 签名

本地开发使用 ad-hoc signing。正式发布使用 Developer ID Application。

签名顺序：

1. Bun runtime
2. native plugins/frameworks/helpers
3. Swift Host
4. 外层 `.app`

签名后执行严格验证。Bun/JSC 所需 hardened runtime entitlements 必须通过实际签名与公证原型确认，不在验证前扩大 entitlement。

## 8. 公证

CLI 支持 Keychain profile：

```bash
fia package \
  --identity "Developer ID Application: Example (TEAMID)" \
  --notary-profile fia-notary \
  --format dmg
```

内部调用 `notarytool submit --wait`，成功后执行 `stapler`，最后用 Gatekeeper 评估产物。

## 9. 可复现性

- 锁定 Bun、CLI 和 Host SDK 版本。
- 保存 build manifest 和输入摘要。
- 禁止在签名后修改包内容。
- 产物记录架构、版本、源码修订版本和签名身份，不记录密钥。

## 10. 分发渠道

首期支持：

- 本地 `.app`
- ZIP
- DMG
- Developer ID 公证下载

首期先完成 Developer ID 站外分发闭环。Mac App Store 需要单独验证 App Sandbox、
entitlement 和商店审核约束，不在首期提供兼容保证。
