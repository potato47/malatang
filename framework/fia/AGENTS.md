# FIA 框架开发规范

## 边界与入口

- 先阅读 `README.md`、`docs/framework/README.md` 和目标目录规范，并检查 Git 状态。FIA 维护通用 GUI、原生能力、通信、生命周期、构建/更新和应用工具链；应用业务与插件平台归应用仓库。
- 框架契约源文件位于 `docs/framework/`；`cli:build` 自动复制到 `packages/cli/docs/framework/`，不要手工修改生成副本。CLI 命令变化同时核对根 README、`packages/cli/README.md` 和框架契约。
- `packages/cli/src/template.ts` 的应用模板与 AGENTS 面向所有 FIA 应用，不能加入麻辣烫业务或个人网站的专用规则。本文件面向框架维护者。

## 开发与联调

- TypeScript 修改重建 `cli:build`；Swift/原生运行时修改先 `runtime:build` 再 `cli:build`，随后执行 `bun run check`，根据影响补充 smoke 或实机验证。版本与发布流程见 `docs/npm-release.md`。
- 当前完整历史已迁入麻辣烫的 `framework/fia/`，这是活跃源码；原独立仓库保留历史。框架仍维护通用能力，不能导入麻辣烫业务。产品稳定后按 `docs/co-development.md` 拆出。
- 在宿主仓库根安装依赖，运行 `framework:prepare/check/pack/verify`；共仓只有宿主根锁文件。独立导出后在框架根安装并生成独立锁文件。工具通过模块解析定位依赖，不固定 node_modules 层级。
- 共仓 dev 自动重建 TypeScript 或 Swift/C 修改并重启实例；构建输出、缓存及框架目录由分开的监听器管理。构建报告记录实际源码和哈希，同版本字符串不保证内容相同。
- FIA npm 共仓发布禁用；归档与独立消费验收继续保留。正式发布与网站部署仍需当次授权。

## 官网与交付

- FIA 官网由独立 Semicoder 仓库的 `content/projects/fia/` 维护；共仓时从宿主根的 `../semicoder/` 维护。该路径只供维护便利，不是框架构建依赖。
- 每次 FIA 版本发布必须同步官网介绍、安装和相关指南，并记录网站内容及部署状态；仅包发布成功不代表官网同步完成。
- API、CLI、平台要求、安装及分发行为改变时，同一任务检查官网影响，更新网站 `docs/project-sources.md` 的版本证据。公开 npm、应用固定归档和本地源码分别描述，不把未发布能力写成默认安装教程。
- 联动规则见 workspace（若存在）的 `docs/agent/development.md`。框架与应用在同仓提交；普通开发不自动推送、发布 npm 或部署网站。
- 仅文档修改核对事实、链接、格式与 Git 差异，不启动无关应用或完整测试。交付说明各仓库修改、验证和待同步条件；未实际验证的内容明确标注。
