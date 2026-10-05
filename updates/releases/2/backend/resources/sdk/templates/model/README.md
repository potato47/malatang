# __PLUGIN_ID__

需要 Bun >= 1.4.2 和支持 SDK 0.2 的麻辣烫开发版本；SDK 快照已保存在 vendor/ 中，无需 npm 发布。此版本尚未正式发行，v0.1.0 应用不支持该插件。

```sh
bun install --ignore-scripts
bun run check
bun run build
bun run pack
```

也可从任意目录使用 `malatang plugin check/build/pack <项目目录>`。开发宿主对应 `bun run agent plugin …`，参数和行为相同。每个命令支持 `--help`、`--json`。

将生成的 `.tgz` 在应用中心安装，或调用现有 `malatang call plugins.install --json '{"source":"/absolute/path/plugin.tgz"}'`。创建和打包不会自动安装插件。

UI 仅从 `@semicoder/malatang-sdk/ui` 导入，React、ReactDOM 和公共组件由宿主提供。业务样式使用 CSS Modules 与 `--m-*` 语义 token。品牌或数据颜色可在 package.json 的 `malatangStyleExceptions` 中以 CSS 文件路径为键、理由为值声明例外，不能覆盖宿主主题或类。图片在 CSS 中相对引用；JS 中导入资源后使用 `new URL(asset, import.meta.url).href`。

manifest 的 keepAlive 保留当前窗口内草稿；隐藏页面关闭弹层，不跨重启恢复。KV 用于持久化数据。模型示例订阅事件后读取状态，在卸载时清理订阅；取消通过 runs.cancel。
