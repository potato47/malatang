# @semicoder/fia 2.0

FIA 的 Bun CLI、浏览器 Native client、可选 Bun Backend adapter 与 Vite 集成。

```ts
import { native } from "@semicoder/fia/client";
import { defineBackend } from "@semicoder/fia/backend";
import fia from "@semicoder/fia/vite";
```

`@semicoder/fia/client` 是浏览器安全入口。`backend` 仅在项目启用 `[backend]` 时进入应用，
`vite` 在开发服务器端持有 Native session 并代理 `/_fia/*` 和 `/api/*`；凭据不会暴露给页面。

配置只从项目根目录的严格 `fia.toml` schema 2 读取，不再提供 JavaScript config export。
Swift Runtime 由根仓库同版本 Git tag 以源码 SwiftPM Package 发布。
