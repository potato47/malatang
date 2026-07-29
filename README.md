# FIA Framework

FIA 是一个面向 macOS 的 Web UI 桌面框架。应用由静态 Web UI、可复用的 Swift/AppKit Host
以及一组 MCP Server 组成；前端与应用能力、原生能力统一使用 MCP `2026-07-28` 通信。

## 要求

- macOS 14+
- Apple Silicon arm64
- Bun 1.3.14+（仅用于开发、构建和打包默认 MCP Server）

最终 `.app` 不依赖用户安装 Bun、Swift、Xcode 或其他运行时。

## 快速开始

```bash
bun run fia -- create hello --no-install
cd hello
bun install
bun run dev
```

默认项目包含 React UI 和一个由 Bun 编译为 standalone Mach-O 的 `app` MCP Server。纯 UI
项目可使用 `fia create hello --no-mcp`。

公共配置固定为 `configVersion: 3`：

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 3,
  app: {
    name: "Hello",
    identifier: "com.example.hello",
    version: "0.1.0",
    mode: "hybrid",
  },
  ui: "src/ui/index.html",
  window: { closeBehavior: "hide", restoreState: true },
  statusBar: { symbol: "circle.grid.2x2.fill" },
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

应用 MCP Server 使用同步工厂定义：

```ts
import { McpServer, defineMcpServer } from "@semicoder/fia/mcp/server";
import { z } from "zod";

export default defineMcpServer(() => {
  const server = new McpServer({ name: "app", version: "0.1.0" });
  server.registerTool("greet", { inputSchema: { name: z.string() } }, ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  }));
  return server;
});
```

UI 通过官方 MCP Client 或 FIA facade 调用 Server：

```ts
import { mcp } from "@semicoder/fia/mcp";
import { native } from "@semicoder/fia/native";

const result = await mcp.server("app").callTool({
  name: "greet",
  arguments: { name: "FIA" },
});
await native.window.setAlwaysOnTop(true);
```

`fia.native` 是 Host 进程内的保留虚拟 MCP Server。`app` 是默认应用 Server。其他 Server
必须是项目内预构建的 arm64 Mach-O，不能从 PATH、shell 或运行时下载。

## 开发与构建

```bash
bun run fia -- doctor
bun run fia -- dev
bun run fia -- run
bun run fia -- build
bun run check
```

- `dev`：Bun 托管 UI HMR；应用 MCP Server 直接由 Bun 执行生成的 stdio runner。
- `run`：构建临时生产 `.app` 并启动，不修改 `dist/`。
- `build`：生成并 ad-hoc 签名 `dist/<App>.app`。
- `check`：运行 TypeScript、CLI 与 Swift Host 全量门禁。

生产布局固定为：

```text
Contents/MacOS/FIAHost
Contents/Resources/UI/
Contents/Helpers/MCPServers/app
Contents/Helpers/MCPServers/<server-id>
Contents/Resources/fia-config.json
```

更多设计与安全边界见[框架文档](./docs/framework/README.md)，实施状态见
[TODO](./TODO.md)。

## npm 发布

```bash
bun run version:npm -- 0.5.1
bun run release:npm --dry-run
bun run release:npm
```

发布载荷仅包含 `packages/cli/package.json` 中列出的 `bin`、`dist`、`templates`、`assets`
与 `README.md`。版本命令会同步 CLI metadata、lockfile 和内嵌 Host，并校验 Host manifest
与 SHA-256。
