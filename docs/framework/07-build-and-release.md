# 构建与发布

生产流程：

```text
load config 4 → typecheck → validate defineBackend → generate runner
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
standalone executable。配置记录 Host schema 7、stdio protocol 2、Backend 固定路径、参数和
签名后 hash。

npm 包只发布 CLI、`config`、`backend`、模板和预编译 Host；发布门禁同步校验 CLI 版本、
Host manifest、能力列表和二进制 checksum。
