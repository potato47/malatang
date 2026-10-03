# @malatang/sdk · 0.1

首版 SDK，当前由本地 workspace 提供，尚未发布 npm。插件为可信本地代码；SDK 命名空间用于组织数据，不是安全隔离。

## 一个插件包

```json
{
  "name": "@example/my-plugin",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "malatang": {
    "schemaVersion": 1,
    "id": "my-plugin",
    "name": "我的应用",
    "description": "一句话介绍",
    "icon": "文",
    "color": "#cf633c",
    "sdkVersion": "0.1",
    "frontend": "dist/client.js",
    "backend": "dist/backend.js"
  }
}
```

`frontend` 必需，`backend` / `styles` 可省略。入口须在包内；浏览器资源放在 `dist/`，不通过资源路由公开后端入口。`id` 是 2–64 位小写字母、数字和连字符，首位为字母；`models` / `plugins` 为宿主保留。ID 同时定义持久数据命名空间，勿随意更改。版本不兼容或重复 ID 会拒绝安装。

## 前端

`src/client.tsx` 默认导出 React 组件：

```tsx
import { createPluginClient } from "@malatang/sdk/client";
import { PageHeader, Button, Panel } from "@malatang/sdk/ui";
const host = createPluginClient("my-plugin");
export default function Page() {
  return <Panel><PageHeader title="我的应用" />
    <Button onClick={() => host.kv.set("example", "hello")}>保存</Button>
  </Panel>;
}
```

能力：`models.list/start`、`runs.list/get/cancel/onChange`、`kv.get/set/delete`、`invoke(method,input)`、`onReconnect`。运行事件只通知变化，订阅后读取快照，重连时再次读取；UI 卸载时解除订阅。`runs.list` 返回最近 30 条摘要（输入输出最多各 300 字符），`runs.get` 返回完整状态。每个模型输出最多 64 KiB，输入/系统提示词各 16,000 字符，最长 180 秒，同时最多 8 次生成。

KV 每值最多 64 KiB。不存在的键返回 null。读写只接受 JSON，值在宿主数据目录持久化。

## 可选后端

```ts
import { definePlugin, defineMethod, z } from "@malatang/sdk/runtime";
export default definePlugin({
  methods: {
    generate: defineMethod("生成文本", z.object({ text: z.string() }), (input, ctx) =>
      ctx.models.start({ modelId: "demo", prompt: input.text }))
  }
});
```

后端 `context` 提供 models 和 KV，`defineMethod` 生成用于发现的 JSON Schema 并在调用时校验输入。方法返回 JSON（最多 256 KiB），长任务调用 `models.start` 返回运行记录，勿长时间占用 `plugins.invoke`。`activate` / `dispose` 可用于短时初始化和资源释放；不要在激活期间启动模型。插件后台自建的长任务尚无宿主管理能力，首版不要绕过宿主创建常驻任务。模型运行或方法调用期间不允许停用 / 卸载。

## UI 约定

宿主只在左侧图标栏提供切换和导航，右侧全部内容空间由当前页面使用，没有宿主顶部导航、第二侧栏或底部状态栏。页面标题、工具栏和内部导航由插件自行组织。宿主提供主题和唯一 React 运行时。基础组件包括 `PageHeader`、`Panel`、`Button`、`Badge`、`Field`、`ModelSelect`、`EmptyState`。主题源文件 `src/theme.css` 随宿主全局加载，插件不重复引入 React 或全局 reset。

使用 `--m-bg`、`--m-surface`、`--m-text`、`--m-muted`、`--m-accent`、`--m-line`、`--m-radius`、`--m-font`。页面外层使用 `.m-page`；表单需可访问标签，操作需 loading / disabled / error 状态。业务 CSS 使用插件前缀，避免覆盖宿主或其他插件；通过 manifest.styles 指定独立 CSS 时，切页会移除 link。第三方 CSS/assets 当前需自行复制到 dist。

宿主在根元素上设置 `data-theme="light|dark|system"`，浅色 / 深色即时切换；system 通过 `prefers-color-scheme` 跟随系统。插件继承同一套变量与 `color-scheme`，不维护独立主题偏好，不覆盖根元素属性。基础 UI 组件已自动适配。

自定义组件应使用语义变量：次级背景 `--m-surface-muted`、悬停背景 `--m-surface-hover`、次级文字 `--m-text-secondary`、占位符 `--m-placeholder`、弱分隔线 `--m-line-soft`、强调按钮文字 `--m-on-accent`。状态色使用 `--m-success` / `--m-warning` / `--m-error` 及相应 `-bg`、`-line` 变量。避免为正文、输入框或面板写死黑白色，完整 token 见 `src/theme.css`。

### 配色与密度基线

2026-10-03 按用户要求参考 VS Code 官方 [Light Modern](https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/light_modern.json)、[Dark Modern](https://github.com/microsoft/vscode/blob/main/extensions/theme-defaults/themes/dark_modern.json) 及 [Theme Color](https://code.visualstudio.com/api/references/theme-color)。采用中性背景、蓝色强调、细边框；状态色的背景与边框为麻辣烫适配值，并非完整复制 VS Code 的界面。

| 用途 | 浅色 | 深色 |
| --- | --- | --- |
| 页面 `--m-bg` | `#ffffff` | `#1f1f1f` |
| 导航 `--m-sidebar` | `#f8f8f8` | `#181818` |
| 正文 `--m-text` | `#3b3b3b` | `#cccccc` |
| 强调 `--m-accent` | `#005fb8` | `#0078d4` |
| 分隔 `--m-line` | `#e5e5e5` | `#2b2b2b` |

输入框使用 `--m-input-bg` / `--m-input-border`，焦点使用 `--m-focus`，次级按钮使用 `--m-button-secondary` / `--m-button-secondary-hover`，文本选区使用 `--m-selection`。区分这些状态，避免把强调色同时作为所有前景色。

宿主活动栏宽 48px，36px 点击区域、20px 工具图标和 4px 项间距；活动项使用中性高亮及蓝色边缘指示。该尺寸参考 [VS Code 活动栏源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/activitybar/activitybarPart.ts)，是结合麻辣烫布局选择的组合。右侧仍由插件独占，不增加顶部导航或第二侧栏。插件自己的品牌图标允许保留识别色。

## 独立构建与打包

在麻辣烫仓库下创建插件目录，开发依赖引用 workspace SDK（外部项目可先使用本地路径依赖）。

```sh
bun packages/sdk/build.ts /absolute/path/my-plugin
cd /absolute/path/my-plugin
bun pm pack
```

构建器把 `src/client.tsx` 和可选的 `src/backend.ts` 编译为对应 `dist` 文件。业务 JS 依赖被打包；React 与 JSX runtime 从宿主共享，插件无需访问宿主源码。不要把服务器代码导入前端。此 MVP 构建器尚未处理原生依赖和额外资源复制。

本地 `bun pm pack`、npm 发布包和 Git 仓库遵循同一个 manifest / dist 格式。Git 来源需要包含预构建 dist，宿主只获取依赖并禁用安装脚本，不替插件构建源码。页面或 CLI 安装后立即激活；前端渲染失败与后端激活失败分别显示。升级流程为卸载再安装，保留 KV 和历史；无自动升级 / 回滚。
