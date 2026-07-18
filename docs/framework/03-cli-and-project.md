# 项目结构、配置与 CLI

## 1. 项目结构

```text
my-app/
├── fia.config.ts
├── package.json
├── bun.lock
├── src/
│   ├── server.ts
│   ├── rpc.ts
│   └── ui/
│       ├── index.html
│       ├── app.tsx
│       └── style.css
├── assets/
│   ├── AppIcon.icns
│   └── StatusIcon.png
├── native/                 可选 SwiftPM 插件
└── tests/
```

生成目录统一放在 `.fia/`，默认加入 `.gitignore`：

```text
.fia/
├── cache/
├── dev/
├── build/
└── logs/
```

## 2. 配置模型

```ts
export default defineConfig({
  app: {
    name: "My App",
    identifier: "com.example.my-app",
    version: "0.1.0",
    minimumMacOS: "14.0",
    mode: "hybrid", // dock | statusBar | hybrid
    quitOnLastWindowClosed: false,
  },

  entry: "src/server.ts",

  window: {
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBar: "hiddenInset",
    vibrancy: "sidebar",
    alwaysOnTop: false,
    visibleOnAllSpaces: false,
    visibleOverFullScreen: false,
    hideInsteadOfClose: true,
  },

  statusBar: {
    enabled: true,
    icon: "assets/StatusIcon.png",
    templateImage: true,
    click: "toggleMainWindow",
  },

  security: {
    navigationAllowlist: [],
    allowDevTools: false,
    contentSecurityPolicy: "default-src 'self'",
  },

  build: {
    architecture: "arm64",
    icon: "assets/AppIcon.icns",
  },
});
```

配置加载后必须通过 schema 校验。未知字段默认报错，避免拼写错误被静默忽略。

## 3. CLI 命令

### `fia create <name>`

- 创建目录和模板
- 生成 bundle identifier
- 安装依赖
- 初始化版本控制（可选）
- 输出下一步命令

### `fia dev`

- 校验环境与配置
- 组装临时开发 `.app`
- 由 Swift Host 启动 `bun --hot`
- 保留 Swift → Bun 生命周期关系
- 聚合但区分 Host、runtime 和 browser 日志
- 文件变更触发 HMR
- native 目录变化时重建并重启 Host

### `fia run`

- 编译生产模式 Bun runtime
- 使用未公证的本地 `.app` 运行
- 用于发现开发服务器与生产构建差异

### `fia build`

- 编译 Bun full-stack executable
- 选择预编译 Host 或构建 native Host
- 生成 Info.plist 和运行配置
- 组装 `.app`
- 执行 ad-hoc 或指定身份签名

### `fia package`

- 生成 ZIP 或 DMG
- 可选 Developer ID 签名
- 可选上传公证并 staple

### `fia doctor`

检查：

- macOS 与 CPU 架构
- Bun 版本
- CLI/Host 版本
- Swift 与 macOS SDK（仅 native 模式必需）
- `codesign`、`notarytool`、`stapler`
- Developer ID 证书
- 配置和图标格式

### `fia native init`

生成 SwiftPM 插件目录。普通项目不执行此命令。

## 4. 通用宿主与原生扩展

MVP 默认只内嵌 arm64 宿主并提取到版本化 cache。x64 和 Universal Binary 在第二阶段
完成 Bun embedded assets 与签名验证后再加入。宿主在最终组装后重新签名。

启用 `native/` 后，CLI 使用 SwiftPM 组合 FIA Host SDK 和用户插件。项目仍不生成 `.xcodeproj`，但本机必须有 Swift compiler 和 macOS SDK。

## 5. 开发进程树

```text
fia dev
└── Swift Host
    └── bun --hot src/server.ts
```

CLI 退出时关闭 CLI → Host 控制管道；Host 随后关闭 Bun，避免开发过程中遗留后台进程。
