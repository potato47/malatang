# 从 FIA 3 迁移到 FIA 4

FIA 4 将共享业务 API、应用 CLI 和 agent skill 作为标准能力。macOS 14+、Apple Silicon 和 Swift Host + Bun + WebView 架构不变。

1. 在 `fia.config.ts` 增加必填 `agent: { command, description }`。command 使用小写字母、数字和单连字符，最多 64 字符，不能为 `fia`；description 最多 1024 字符。可选 `instructions` 指向业务说明 Markdown。
2. 新建默认 `shared/api.ts`，从 `@semicoder/fia/api` 导入 `defineAPI` 和 `z`。声明方法的 description/input/output 与事件的 description/payload。契约保持无初始化副作用；可使用 `api.entry` 改路径。
3. 在 `defineBackend` 中提供 `api: implementAPI(contract, handlers)`，将 UI 与 CLI 共用的业务操作放入 handlers。HTTP 配置现在可省略；已有自定义 HTTP/WS 可继续使用。
4. 前端从 `@semicoder/fia/client` 导入 `createClient`，使用 `createClient<typeof api>()` 的 call/on/onReconnect。断线重连后重新读取状态，框架不提供事件重放。
5. `windows.create` 只创建和配置，不再自动显示。需要立即显示的辅助窗口增加 `native.windows.open`。主窗口由框架根据前台/CLI 启动决定是否显示。不要以页面可见性作为 `native.ready()` 的前提；隐藏更新验证也需要就绪报告。
6. CLI 启动不显示窗口。建议声明 `statusItem`，为人类提供显示应用和退出入口；完整退出会停止后端。框架不安装独立 daemon。
7. 可选 `beforeUpdate(context)` 返回 `{ready:false, reason}`，阻止业务后台任务期间的代码切换。在途共享 API 调用或 CLI 脚本也会阻止切换；下载的候选保留。应用数据迁移仍须兼容上一版。
8. 安装 CLI 是显式操作：应用菜单、tray 或 `native.agent.installCLI()`；检测和卸载使用 status/uninstallCLI。默认目标 `~/.local/bin`，不自动修改 shell 配置或覆盖其他命令。skill 通过 `<command> skill install [--dir DIRECTORY]` 安装。

Host–Bun 协议升级到 5，runtime manifest 升级到 4，新增 agent protocol 1。必须重新构建并分发完整 `.app`，不能将 FIA 4 代码更新推送给 FIA 3 运行时。后续同一运行时的 API、UI、schema 和 skill 可一起代码更新和回退。CLI 引导程序、命令名、Bun 或原生宿主变化需要完整安装包。

脚本执行默认 60 秒超时，`--timeout` 单位毫秒，0 表示不限时。脚本可访问本机文件、网络和进程，不是权限隔离方案。不自动安装依赖，不保留跨调用变量。CLI 连接中断时业务写入可能已经发生，框架不自动重试。
