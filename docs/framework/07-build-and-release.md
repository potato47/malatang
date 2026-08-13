# 构建与发布

生产流程：

```text
load config 5 → typecheck → validate defineBackend → generate runner
→ bun build --compile --target=bun-darwin-arm64
→ stdio ready + loopback health smoke
→ assemble app → sign Backend → record signed SHA-256 → sign app → verify
```

固定布局：

```text
<App>.app/Contents/
├── MacOS/FIAHost
├── Helpers/FIABackend
├── Resources/fia-config.json
└── Info.plist
```

不存在独立 UI 目录：通过 Backend HTML imports 引用的 HTML、JS、CSS 和资源由 Bun 编入
standalone executable。配置记录 Host schema 8、stdio protocol 2、Backend 固定路径、参数和
签名后 hash。

默认构建对 Helper 与 App 做 ad-hoc 签名。配置 `signing.identity` 时，CLI 先验证精确匹配的
Apple Development 或 Developer ID Application identity，再用同一 identity 完成 inside-out
签名；这用于稳定本地代码身份和 TCC 授权，不等同于 Developer ID 发布、公证或自动更新。

npm 包只发布 CLI、`config`、`backend`、模板和预编译 Host。Host asset manifest schema 保持 3；
发布门禁同步校验 CLI 版本、Host manifest、能力列表和二进制 checksum。
