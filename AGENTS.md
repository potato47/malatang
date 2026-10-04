# FIA 4 application

Declare shared operations and events in shared/api.ts. Implement them in backend/ with implementAPI; call them from frontend/ using createClient. Keep the contract module free of backend initialization and side effects. Update agent/instructions.md with business workflows. Do not start another server, port or CLI; use defineBackend.http for custom HTTP and WebSocket routes relative to /api. Custom routes are not available through the application CLI. Use fia agent for the current development instance. Run bun run check and bun run build before delivery. Call native.ready() on first frontend mount even when hidden. windows.create declares windows; use open to present them. Persist business data under context.app.dataDirectory. Scripts are trusted local code; persistent jobs belong in your backend. Return a task ID promptly, use context.emit in start/routes for background events, veto updates in beforeUpdate while busy, and cancel tasks in stop. API messages are limited to 1 MiB of UTF-8. Use events --count N --timeout MS --match JSON to wait for matching events; timeout exits 124. Events have no replay, so subscribe before triggering work and reread state after waiting. For browser debugging use fia dev --open-browser or fia agent open --browser --url; tickets expire after 60 seconds and must be refreshed after backend restart. Framework documentation is included at node_modules/@semicoder/fia/docs/framework/README.md.

## 麻辣烫项目协作

- 先阅读 README、SDK 与相关发布文档，检查 Git 状态。模型、插件平台、SDK/UI 与业务工作流由本仓库维护；通用 GUI/原生/构建问题先在 FIA 修复并验证，再接入应用。
- workspace 中的 FIA 是共同开发项目。框架重建后执行 `bun install --force --ignore-scripts` 刷新本地包，验证实际消费的产物；应用依赖新能力时同时检查 `release/runtime-lock.json` 的源码提交与归档 SHA-256。仅凭同版本号不能确认一致。
- 修改业务 API、模型、插件契约时，核对 `shared/api.ts`、`agent/instructions.md`、`packages/sdk/README.md`、内置/示例插件及根 README；模型目录升级同时维护迁移与不可用状态说明。
- 官网在独立 Semicoder 仓库的 `content/projects/malatang/`，workspace 入口为 `../semicoder/`。可见行为、SDK、安装与发布变化需在同一任务检查对应页面，并在网站 `docs/project-sources.md` 记录来源。网站不是应用运行/构建依赖。
- 应用 `v*`、SDK `sdk-v*` 与网站主干部署分别管理；应用更新源由应用发布流程维护，不因官网迁入个人网站而更换。未发布变更与公开固定快照分开说明，普通开发不自动推送或发布。
- workspace 内遵守根 `docs/agent/development.md`。以上 check/build 要求适用于实现修改；仅文档/规范修改按 workspace 规则检查事实、链接、格式与差异，不启动应用或运行无关完整测试。
