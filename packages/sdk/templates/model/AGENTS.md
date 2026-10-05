# 麻辣烫 SDK 0.2 插件开发

先阅读 README。使用公共 SDK 的 client、types、runtime、ui 入口。不要导入宿主私有类、Radix 或全局 CSS，不复制 React 或公共组件。业务 CSS 必须为 .module.css；优先使用语义 token。控件使用 sm(28px)/md(36px)。Field 内使用一个 SDK 控件以关联标签和错误。

插件拥有完整页面；用 Page、PageHeader、PanelHeader/Content/Footer 组织内容。弹层用 Menu、Popover、Dialog、Tooltip；UIProvider 的页面作用域由宿主管理。清理事件订阅和异步回调。backend.ts 存在时声明 manifest.backend 为 dist/backend.js。

修改后运行 bun run check、bun run build、bun run pack；在麻辣烫中安装归档验证。不要自动安装依赖、发布或改写用户项目外文件。
