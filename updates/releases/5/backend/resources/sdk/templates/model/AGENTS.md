# 麻辣烫 SDK 0.3 插件开发（未发布）

先阅读 README。公共能力从 SDK 的 client、types、runtime、ui 入口导入；不直接导入 Base UI、Radix、Lucide 或宿主私有样式，不复制 React 和公共组件。

使用 p: 前缀的完整静态 Tailwind 类名与语义颜色。src/styles.css 只导入 SDK tailwind.css 映射，由 CLI 构建；其他业务样式用 CSS Modules。禁止全局 reset、主题覆盖和宿主私有类。控件尺寸 sm/md/lg 为 28/36/40px。

浮层使用组合式 Trigger/Content 与 render。Select/Combobox 使用 value/onValueChange；Checkbox/Switch 使用 checked/onCheckedChange。Field 内放一个控件。UIProvider 和 Portal 由宿主管理；清理订阅及异步回调。backend.ts 存在时同步声明清单。

修改后运行 bun run check、bun run build、bun run pack，并在开发宿主安装归档验收。不要自动发布或修改项目外文件。
