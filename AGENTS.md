# FIA 框架开发规范

## 边界与入口

- 先阅读 `README.md`、`docs/framework/README.md` 和目标目录规范，并检查 Git 状态。FIA 维护通用 GUI、原生能力、通信、生命周期、构建/更新和应用工具链；应用业务与插件平台归应用仓库。
- 框架契约源文件位于 `docs/framework/`；`cli:build` 自动复制到 `packages/cli/docs/framework/`，不要手工修改生成副本。CLI 命令变化同时核对根 README、`packages/cli/README.md` 和框架契约。
- `packages/cli/src/template.ts` 的应用模板与 AGENTS 面向所有 FIA 应用，不能加入麻辣烫业务或个人网站的专用规则。本文件面向框架维护者。

## 开发与联调

- TypeScript 修改重建 `cli:build`；Swift/原生运行时修改先 `runtime:build` 再 `cli:build`，随后执行 `bun run check`，根据影响补充 smoke 或实机验证。版本与发布流程见 `docs/npm-release.md`。
- 在 FIA workspace 内，麻辣烫使用 `file:../fia/packages/cli` 的复制安装包。框架修改后在应用执行 `bun install --force --ignore-scripts` 并验证实际产物；仅修改相邻源码不算接入完成。
- 发布归档以源码提交、版本、运行时清单和 SHA-256 识别；同版本字符串不保证内容一致。依赖新框架行为时检查应用的 `release/runtime-lock.json`，记录公开/CI 归档是否仍需更新。

## 官网与交付

- FIA 官网由独立 Semicoder 仓库的 `content/projects/fia/` 维护；在 workspace 中入口为 `../semicoder/`。该路径是维护便利，不是框架构建依赖。
- API、CLI、平台要求、安装及分发行为改变时，同一任务检查官网影响，更新网站 `docs/project-sources.md` 的版本证据。公开 npm、应用固定归档和本地源码分别描述，不把未发布能力写成默认安装教程。
- 联动规则见 workspace（若存在）的 `docs/agent/development.md`。仓库独立提交；普通开发不自动推送、发布 npm 或部署网站。
- 仅文档修改核对事实、链接、格式与 Git 差异，不启动无关应用或完整测试。交付说明各仓库修改、验证和待同步条件；未实际验证的内容明确标注。
