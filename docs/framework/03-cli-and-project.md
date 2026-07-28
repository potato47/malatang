# 项目结构、配置与 CLI

## 默认项目

```text
fia.config.ts
src/
├── ui/
│   ├── index.html
│   └── App.tsx
├── mcp/
│   └── server.ts
└── shared/
    └── types.ts
```

`fia create <name>` 默认生成 React UI 和 Bun MCP Server；`--no-mcp` 生成纯 UI 项目。
`--no-install` 跳过依赖安装，`--git` 初始化仓库。已删除 `--runtime`。

## 公共配置

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 3,
  app: {
    name: "Hello",
    identifier: "com.example.hello",
    version: "0.1.0",
    mode: "hybrid",
    icon: "assets/AppIcon.icns",
  },
  ui: "src/ui/index.html",
  window: {
    width: 1024,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    closeBehavior: "hide",
    restoreState: true,
    alwaysOnTop: false,
    visibleOnAllSpaces: false,
    visibleOverFullScreen: false,
  },
  statusBar: {
    symbol: "circle.grid.2x2.fill",
    tooltip: "Hello",
  },
  mcp: {
    app: {
      entry: "src/mcp/server.ts",
      watch: ["src/mcp", "src/shared"],
    },
    servers: {
      search: {
        executable: "mcp/search-server",
        args: ["--stdio"],
      },
    },
  },
});
```

`mcp`、`mcp.app` 和 `mcp.servers` 都可省略。未指定 `watch` 时默认监听 entry 所在目录。

## Server ID 与路径

- `app`：默认应用 Server 保留 ID。
- `fia.native`：Host 内置 Server 保留 ID。
- 其他 ID：`[a-z0-9.-]`，首尾必须为字母或数字，不允许 `..` 或 `fia.*`。
- 所有 UI、icon、entry、watch 和 executable 都按配置文件所在项目根解析。
- 绝对路径、目录穿越、物理路径越界和符号链接越界直接拒绝。
- 外部 executable 必须存在、可读、可执行；build 阶段还必须验证 arm64 Mach-O。
- 配置采用严格未知字段策略，旧字段不会被忽略。

## 命令

- `fia dev`：创建临时开发 `.app`，启动 UI HMR 与 Host；MCP 源码变更只重启对应 Server。
- `fia run`：创建并运行临时生产 `.app`。
- `fia build`：原子写入 `dist/<name>.app`。
- `fia doctor`：检查 macOS、arm64、Bun、codesign 和工作目录；Host 开发/发布工具为可选项。

`dev` 中 UI HMR 不重启 MCP Server。`mcp.app.watch` 发生变化时，CLI 先验证生成 runner，
再通过 Host stdin 的 dev-only 控制消息重启 `app`；失败时保留当前进程。预构建 executable
被替换时重启对应 Server。
