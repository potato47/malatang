# 麻辣烫 · Malatang

基于 FIA 的本地插件应用平台。宿主提供模型、存储和统一界面组件，独立插件组合这些能力，拥有自己的应用页面。

## 运行

需要 macOS / Apple Silicon 与 Bun（当前验证版本 1.4.2）。当前通过 `file:../fia/packages/cli` 使用相邻 FIA 源码的构建产物，以接入原生外观切换；首次运行需先构建框架（需要 Swift 工具链）。

```sh
cd ../fia
bun install --ignore-scripts
bun run runtime:build
bun run cli:build
cd ../malatang
bun install --ignore-scripts
bun run dev
```

本地 FIA 包由 Bun 安装到依赖目录，不是实时源码链接。修改 FIA 后先重新构建 runtime / CLI，再在麻辣烫运行 `bun install --force --ignore-scripts` 刷新依赖，最后重建应用。

会启动 FIA 桌面应用。在开发实例已运行时，获取一次性浏览器链接：

```sh
bun run agent open --browser --url
```

`bun run build` 生成 `dist/Malatang.app`。开发和打包应用使用各自的 FIA 数据目录，互不覆盖。开发后端读取资源的根目录是项目目录；打包后是随应用分发的 backend 目录。

## 先体验

1. 打开「译文」，直接翻译预置示例。默认演示模型只展示流式交互，对任意文本不提供真实翻译。
2. 在「模型设置」添加 OpenAI-compatible Chat Completions 服务（Base URL、模型 ID、API Key），即可进行真实翻译。连接在调用时验证。
3. 在「应用中心」安装随手记示例，它由 `bun pm pack` 独立打包，使用公开 SDK 和宿主 KV。
4. 停用、启用或卸载插件；卸载保留 KV 和运行历史。
5. 点击左侧图标栏底部的外观按钮，选择浅色、深色或跟随系统；选择会保存在本机，重启后恢复。插件页面、SDK 组件与原生标题栏同步切换。

## 当前范围

- 图标侧栏、插件页面和统一 UI tokens / React 组件。
- 浅色 / 深色 / 跟随系统主题；应用级偏好持久化，默认跟随系统。
- 配色参考 VS Code Light Modern / Dark Modern，使用中性灰与蓝色强调；48px 紧凑图标侧栏。
- 版本化 manifest、独立构建前端 / 可选后端、动态插件方法及输入 schema。
- 宿主模型列表、流式文本生成、取消、最近 30 次运行摘要及完整快照、重连读取。
- 按插件 ID 划分的持久化 KV；原子文件替换和串行写入。
- 页面与 FIA CLI 共用安装接口，接收 npm 包、Git HTTPS 来源及本地 `.tgz`；随手记本地包路径已经实测。

可信本地扩展与宿主同进程执行，不构成安全沙箱。模型密钥不通过 API 返回前端，当前在本机权限受限的配置文件中保存，尚未接入 Keychain。

当前尚未实现多 provider 专用协议、工具注册 / 调用、agent loop、调研应用、插件自动升级、签名分发。npm/Git 下载路径已实现但尚未用远端真实插件验收；要求预构建、自包含产物，安装不执行生命周期脚本。

## 插件开发

见 [SDK 文档](packages/sdk/README.md)。完整例子：

- `plugins/translate/`：内置前后端插件，仅经 SDK 调用模型及存储。
- `examples/quick-notes/`：独立前端插件，打包安装后使用 KV。

当前 SDK 为 workspace 包，尚未发布 npm。构建脚本把插件业务依赖打入产物，并通过宿主共享 React 避免重复运行时。

## CLI

复用 FIA 的应用命令，开发中使用 `bun run agent`，无额外服务或 CLI。

```sh
bun run agent call models.list --json '{}'
bun run agent call appearance.get --json '{}'
bun run agent call appearance.set --json '{"theme":"dark"}'
bun run agent call plugins.list --json '{}'
bun run agent call plugins.install --json '{"source":"/absolute/path/plugin.tgz"}'
bun run agent call plugins.jobs --json '{}'
bun run agent call plugins.invoke --json '{"pluginId":"translate","method":"translate","input":{"text":"Hello","target":"简体中文","modelId":"demo"}}'
bun run agent call runs.list --json '{"pluginId":"translate"}'
```

安装和生成返回任务 ID，需查询终态。动态业务方法在 `plugins.list.methods` 中提供名称、描述和 JSON Schema。列表中的运行文本截为 300 字符，完整结果使用 `runs.get`。

## 检查

```sh
bun test tests
bun run check
bun run build
```

测试覆盖字节分片 SSE、失败与取消、凭证隐藏、KV 并发与重启、主题偏好迁移 / 持久化 / 并发切换、manifest / 路径校验、独立后端加载以及本地归档安装 / 重启 / 卸载。安装测试需要 Bun 能写入临时目录和本机包缓存。
