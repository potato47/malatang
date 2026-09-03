# 构建与发布

生产流程：

```text
load config 6 → typecheck → validate defineBackend → validate custom Host/helpers → generate runner
→ bun build --compile --target=bun-darwin-arm64
→ stdio ready + loopback health smoke
→ assemble app → sign Backend → record signed SHA-256
→ sign helpers by name → sign Host → sign app → verify every nested executable
```

发布流程在上述生产构建后继续：

```text
Developer ID + hardened runtime + timestamp
→ pre-notarization ZIP → notarytool submit --wait
→ staple + validate → Gatekeeper assess → final ZIP + SHA-256
```

固定布局：

```text
<App>.app/Contents/
├── MacOS/FIAHost
├── Helpers/FIABackend
├── Helpers/<optional app helper>
├── Resources/fia-config.json
└── Info.plist
```

不存在独立 UI 目录：通过 Backend HTML imports 引用的 HTML、JS、CSS 和资源由 Bun 编入
standalone executable。配置记录 Host schema 8、stdio protocol 2、Backend 固定路径、参数和
签名后 hash。

配置 `host` 时 `MacOS/FIAHost` 被 `MacOS/<host.name>` 替代，并同步写入
`CFBundleExecutable`。custom Host 与 helpers 必须是项目目录内可读、可执行的纯 arm64 Mach-O；
helper 名称唯一且不能占用 `FIABackend`。

默认构建对 Backend、额外 helpers、Host 与 App 做 ad-hoc 签名。配置 `signing.identity` 时，CLI 先验证精确匹配的
Apple Development 或 Developer ID Application identity，再用同一 identity 完成 inside-out
签名；这用于稳定本地代码身份和 TCC 授权。

`fia package` 要求独立的 `release.identity`，为 Backend、helpers、Host 和 App 启用 Hardened Runtime 与安全
时间戳，并输出保留资源 fork 的 arm64 预公证 ZIP 和 SHA-256。Backend 单独使用 JIT
entitlement，顶层 App 不使用 `--deep` 执行发布签名。`fia release` 将临时 ZIP 提交给
`notarytool`，接受后 staple App、验证 ticket 与 Gatekeeper，再重新生成最终 ZIP。凭据只通过
配置的钥匙串 profile 读取。

当前发布目标仍是 arm64；universal binary、DMG、自动更新与发布 CI 属于后续范围。

npm 包只发布 CLI、`config`、`backend`、模板和预编译 Host。Host asset manifest schema 保持 3；
发布门禁同步校验 CLI 版本、Host manifest、能力列表和二进制 checksum。
