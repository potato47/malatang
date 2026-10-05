# SDK 0.2 与插件开发 CLI（未发布）

本地特性分支提供统一 UI、CSS Modules 和 `malatang plugin create/check/build/pack`。SDK npm 版本为 0.2.0，manifest.sdkVersion 为 0.2。正式 v0.1.0 应用、已发布 FIA npm 0.16.1 和旧固定归档均不因此获得新能力。

开发者安装 Bun >=1.4.2。开发宿主先运行 `bun run dev`，再使用 `bun run agent plugin create /tmp/my-plugin --template notes`；安装开发应用 CLI 后同样可运行 `malatang plugin create …`。项目创建后执行 `bun install --ignore-scripts`。模板内脚本与应用 CLI 使用同一 SDK 实现。选项、组件、资源与生命周期见 [SDK README](../packages/sdk/README.md)。

应用构建通过 `scripts/sdk-snapshot.ts` 生成并解包验证 SDK 快照，将其和模板作为后端资源嵌入。独立消费验证使用 `bun run npm:pack`。客户端共享 React、JSX、ReactDOM、UI 模块；模板锁定 React/ReactDOM 为同一版本，避免工具依赖加载时报版本不匹配。

`plugin check` 验证清单、类型、CSS 和资源；`build` 失败清除 dist；`pack` 只输出 package.json 和完整 dist 并解包比对资源。SDK 0.1 安装/恢复时清晰提示重新构建；旧 KV、模型、账号与历史保留。

开发设置增加组件样例页，用于主题、两档控件尺寸、loading/disabled/error、标签、键盘与嵌套弹层验收。发布构建不显示此入口。公共弹层随 PageSlot/UIProvider 隐藏而关闭；内置翻译与随手记的业务样式已移回插件。

## 框架及发布边界

FIA 使用 agent.commands 声明自定义命令。执行跟随当前代码，沿用脚本监督、取消与更新占用；上下文提供 args、cwd、assetsDirectory。FIA 源码先完成 check/runtime:build/cli:build，然后应用 `bun install --force --ignore-scripts` 刷新本地包。

新 CLI 改变 runtimeId，后续发行需要新的完整安装包。新的本地固定归档、SHA-256 和验证结果记录在根工作区会话文档；`release/runtime-lock.json` 暂保留已验证公开旧归档，远端归档发布和 CI 下载锁切换须另行授权，不能拿旧锁运行本分支发布流程。
