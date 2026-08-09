# @semicoder/fia

FIA 的 CLI、配置类型和 Bun Backend runtime。Swift 状态栏 Host 启动唯一的常驻 Backend；
Backend 通过 stdio 调用原生能力，并向浏览器/WebView 提供普通 HTTP 与 WebSocket。

## 公共导出

- `@semicoder/fia/config`：`configVersion: 4` 配置类型与 `defineConfig`。
- `@semicoder/fia/backend`：Bun-only `defineBackend`、HTTP/WS runtime 和类型化 Host API。

不存在浏览器 FIA runtime、Native bridge 或 MCP 导出。

```ts
import { defineBackend } from "@semicoder/fia/backend";

export default defineBackend({
  http: {
    routes: {
      "/api/status": { GET: () => Response.json({ ok: true }) },
    },
  },
  async start({ host, url }) {
    host.statusItem.onClick(() => {
      void host.webviews.open({ id: "main", url: url("/").href });
    });
  },
});
```

`publicRoutes` 明确承载公开 HTML/静态资源；`routes`、`fetch` 与 WebSocket upgrade 默认要求
FIA 会话。应用页面由 Host 安全打开时会自动建立 HttpOnly 会话，前端无需处理令牌。
通过 `host.statusItem.onClick`、`host.statusItem.onAction` 和 `host.webviews.onEvent` 注册的监听器
属于当前 `start` 生命周期，FIA 会在热重载或 Backend 停止时自动注销。`stop` 只需清理应用自行
创建的定时器、连接等资源。
