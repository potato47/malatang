# `@semicoder/fia`

FIA 的 CLI、配置类型、浏览器 MCP Client、MCP Server 工厂与原生能力 facade。

```bash
fia create hello
fia create hello --no-mcp
fia create hello --no-install --git
fia dev
fia run
fia build
fia doctor --json
```

FIA 0.5 使用 `configVersion: 3` 和 MCP `2026-07-28`，不兼容旧 Runtime、Swift Backend
或 UI-only Runtime 配置：

```ts
import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 3,
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
  mcp: {
    app: { entry: "src/mcp/server.ts" },
    servers: {
      search: { executable: "mcp/search-server", args: ["--stdio"] },
    },
  },
});
```

`mcp` 可省略以创建纯 UI 应用。`app` 与 `fia.native` 是保留 ID；外部 ID 只允许小写字母、
数字、点和连字符，且不能使用 `fia.*`。额外 Server 必须是项目内、不可越过符号链接边界、
具有执行权限的 arm64 Mach-O。

```ts
import { McpServer, defineMcpServer } from "@semicoder/fia/mcp/server";

export default defineMcpServer(() => {
  return new McpServer({ name: "app", version: "0.1.0" });
});
```

FIA 生成最终 stdio 入口，并拒绝 legacy MCP。开发时 Bun 直接执行入口；生产时使用
`bun build --compile --target=bun-darwin-arm64` 生成 standalone Server，最终用户无需 Bun。

浏览器端：

```ts
import { mcp } from "@semicoder/fia/mcp";
import { native } from "@semicoder/fia/native";

await mcp.server("app").callTool({ name: "greet", arguments: { name: "FIA" } });
const client = await mcp.server("app").client();
await native.window.show();
```

FIA 当前要求 macOS 14+、Apple Silicon 和 Bun 1.3.14+。Swift/Xcode 只在开发 FIA Host
本身时需要。
