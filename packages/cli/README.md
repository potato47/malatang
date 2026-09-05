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

从源码仓库构建并全局 `bun link` 后，可用 `fia create my-app --local` 创建本地调试项目。
生成的项目通过 Bun `link:` 连接本地 CLI/SDK，通过 SwiftPM 路径依赖连接同一仓库的
Swift Runtime，无需发布新版本。修改 CLI/SDK 后，在仓库根目录执行 `bun run cli:build`
并重启项目；修改 Swift 后重启项目以增量编译。省略 `--local` 时仍使用发布版本。

## 创建项目向导

运行 `fia create` 可依次填写项目名，选择 Web、Native 或 Hybrid 模板，以及是否启用
Bun Backend、初始化 Git 和安装依赖。使用方向键选择、回车确认；Ctrl+C 取消，退出码为
130，向导取消时不会创建文件。默认选择 Web、不启用 Backend、不初始化 Git、安装依赖。

`fia create my-app` 跳过项目名问题；显式参数跳过对应问题。`--local` 仅通过参数指定。
支持 `--template native|web|hybrid`、`--backend bun` / `--no-backend`、
`--git` / `--no-git`、`--install` / `--no-install`；相反开关不能同时使用。

```bash
fia create
fia create my-app --template hybrid --git
fia create script-app --yes --no-install
```

`-y` / `--yes` 跳过所有问题，未指定选项采用默认值。CI 或 stdin/stdout 非 TTY 时也不会
进入交互；这些情况下必须提供项目名。项目名须为小写 kebab-case，目标目录不能已存在。
