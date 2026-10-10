# 从 FIA 2 迁移到 FIA 3

FIA 3 是破坏性重构，不保留 2.0 兼容入口。先备份项目，在新模板中迁移前端和 Bun 业务代码。

1. 使用 `fia create` 创建新项目。删除应用自己的 native/、native-api/、fia.toml、fia.lock 和生成的 Swift/Native client。
2. 将应用名称、identifier、version、build、图标和发布设置迁入 `fia.config.ts`。保留原 identifier，才能继续访问原应用数据和 Keychain。权限说明使用 Info.plist UsageDescription 键。
3. 将业务处理器放入 `backend/index.ts` 的 `defineBackend`。路由相对 `/api`；前端调用 `/api/hello` 对应后端 `/hello`。不再启用或添加 Bun 模式。
4. 将 Swift 创建窗口和标题栏的代码改为 `context.native.windows` 调用。默认 main 已存在；`create/update/setTitlebar` 使用稳定 id。Swift 自定义原生方法与纯原生界面无法自动迁移；需要框架提供对应原生能力后再接入。
5. 前端继续从 `@semicoder/fia/client` 使用 `native`，传输统一经过 Bun。删除 Browser Companion 能力分支及 Swift 网关配置。首次 UI 挂载后调用 `native.ready()`。
6. `windows.createWeb` 改为 `windows.create`。`updater` 改为 `updates`，使用 check/download/apply/state。旧 Sparkle feed 和公钥不能复用，需生成 FIA 更新签名密钥并发布第一个 FIA 3 完整安装包。
7. 后端 start 中重新声明窗口控件、注册事件；stop 中关闭业务资源。重启不保留 JS 单例、定时器、WebSocket 或数据库连接。
8. 数据继续存放在 `Application Support/<identifier>/Backend`。不要在可替换的代码目录存储用户数据。热更新回退只回退代码。

先运行 `fia check`、`fia build`、`fia smoke`，再验证自己的数据库迁移和原生操作。生产签名、公证和安装包升级需要单独验收。
