# 构建、签名与发布

## 构建流水线

```text
严格解析 config v3
  → 构建静态 UI
  → 生成/编译 app MCP Server
  → 校验外部 arm64 Mach-O
  → modern discover + tools/list 冒烟
  → 复制到 staging .app
  → Server → Host → App 签名
  → 严格签名、布局与哈希验证
  → 原子替换 dist 产物
```

UI 使用 Bun HTML bundler。生产文件放入 `Contents/Resources/UI`，Host 不启动 UI Runtime。
默认应用 Server 使用：

```bash
bun build --compile \
  --target=bun-darwin-arm64 \
  --minify \
  --no-compile-autoload-dotenv \
  --no-compile-autoload-bunfig
```

## 固定应用布局

```text
Contents/
├── MacOS/FIAHost
├── Helpers/MCPServers/
│   ├── app
│   └── <server-id>
├── Resources/
│   ├── UI/
│   └── fia-config.json
├── Info.plist
└── PkgInfo
```

产物不得包含旧 `fia-runtime`、`fia-backend`、Swift SDK 或外部 Bun 依赖。

## Host manifest

随 npm 包发布的 Host manifest 声明：

- manifest schema 2；
- CLI/Host 版本 0.5.0；
- arm64、macOS 14；
- Host config schema 5；
- bridge 1；
- MCP `2026-07-28`；
- Native MCP tools/resources/subscriptions；
- Host 二进制 SHA-256。

CLI 在复制 Host 前校验全部字段、架构、执行权限和 SHA-256。

## 签名

当前本地构建使用 ad-hoc 签名。顺序固定为：

1. 每个 MCP Server；
2. Swift Host；
3. 外层 `.app`；
4. `codesign --verify --strict --deep`。

Server 的配置 SHA-256 在 Server 签名后计算，签名后不得再修改包内容。

## npm 发布文件清单

`@semicoder/fia` 0.5.0 只发布：

- `bin/`
- `dist/`
- `templates/`
- `assets/`
- `README.md`
- npm 自动包含的 `package.json`

`dist` 必须只含 CLI、config、MCP client/server 与 native facade 的 JS/types。包内不得包含
旧 runtime/backend 模块、Swift Backend SDK、prototype 或仓库文档。

```bash
bun run version:npm -- 0.5.1
bun run release:npm --dry-run
bun run release:npm
```

正式 Developer ID、hardened runtime、公证、DMG/ZIP 和 Gatekeeper 验证属于下一发布阶段。
