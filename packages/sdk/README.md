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
    "backend": "dist/backend.js",
    "keepAlive": true
  }
}
```

`frontend` 必需，`backend` / `styles` 可省略。入口须在包内；浏览器资源放在 `dist/`，不通过资源路由公开后端入口。`id` 是 2–64 位小写字母、数字和连字符，首位为字母；`models` / `plugins` / `settings` 为宿主保留。ID 同时定义持久数据命名空间，勿随意更改。版本不兼容或重复 ID 会拒绝安装。

`keepAlive` 是可选布尔值，默认 `false`。仅需要保留页面实例的插件声明为 `true`；现有未声明的插件仍在切页时卸载。该字段需要支持它的新版宿主，旧版严格 manifest 校验会拒绝含新字段的包。SDK 尚未发布，当前 schemaVersion / sdkVersion 保持 1 / 0.1。

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

能力：`models.list/start/onChange`、`runs.list/get/cancel/onChange`、`kv.get/set/delete`、`invoke(method,input)`、`onReconnect`。运行事件只通知变化，订阅后读取快照，重连时再次读取；UI 卸载时解除订阅。`runs.list` 返回最近 30 条摘要（输入输出最多各 300 字符），`runs.get` 返回完整状态。每个模型输出最多 64 KiB，输入/系统提示词各 16,000 字符，最长 180 秒，同时最多 8 次生成。

模型由宿主「设置 → 模型服务」管理。`ModelInfo.kind` 为 `openai-compatible`、`pi` 或 `chatgpt`；`preset` 为 Pi provider ID 或 null，`options` 为非密钥配置，`hasApiKey` 仅指是否已保存密钥，`configured` 不代表连通性已验证。没有配置时返回空列表，不再提供模拟模型；插件应提示配置并禁用生成。`ModelRun.demo` 仅兼容旧演示历史，新运行恒为 false。API 不返回密钥。插件仍使用宿主模型 `id` 调用，无需依赖 Pi 或选择协议。`models.onChange(listener)` 返回取消订阅函数；订阅后和重连时重读 `models.list()`，避免 keepAlive 页面缓存过期列表。

KV 每值最多 64 KiB。不存在的键返回 null。读写只接受 JSON，值在宿主数据目录持久化。

### 页面生命周期

- 所有页面均首次访问才加载。`keepAlive: false` 时切走卸载，React effect cleanup 应释放订阅、定时器及页面资源；返回时重新初始化。
- `keepAlive: true` 时切走只隐藏页面，保留组件状态、DOM 与独立滚动位置；隐藏页面不参与布局、键盘导航和无障碍访问，effect 和事件订阅继续运行。此模式会持续占用内存，重页面应谨慎开启。
- 插件停用、卸载、后端激活状态失效，或版本 / 前端 / 样式资源 URL / keepAlive 声明变化时释放旧实例；重新启用后首次访问再创建。普通目录刷新、短暂连接失败不清空已保留的页面。
- 保留仅限当前窗口运行期间，无自动淘汰。刷新或重启不恢复未保存草稿，需持久化的数据继续使用 KV。翻译、随手记显式开启，应用中心与设置面板（含各设置分类）由宿主保留以避免切页丢失表单。
- 页面卸载不等于后端插件停用，不取消宿主模型任务，也不保证回收已导入的 JS 模块缓存或插件自行泄漏的全局对象。不要把“切页”当作任务取消信号。

`plugins.list` 返回归一化的 `keepAlive` 布尔值。已经安装的旧随手记归档不会被宿主隐式修改；需要安装新版归档才会开启保留，卸载重装仍保留原有 KV。

## 可选后端

```ts
import { definePlugin, defineMethod, z } from "@malatang/sdk/runtime";
export default definePlugin({
  methods: {
    generate: defineMethod("生成文本", z.object({ text: z.string(), modelId: z.string() }), (input, ctx) =>
      ctx.models.start({ modelId: input.modelId, prompt: input.text }))
  }
});
```

后端 `context` 提供 models 和 KV，`defineMethod` 生成用于发现的 JSON Schema 并在调用时校验输入。方法返回 JSON（最多 256 KiB），长任务调用 `models.start` 返回运行记录，勿长时间占用 `plugins.invoke`。`activate` / `dispose` 可用于短时初始化和资源释放；不要在激活期间启动模型。插件后台自建的长任务尚无宿主管理能力，首版不要绕过宿主创建常驻任务。模型运行或方法调用期间不允许停用 / 卸载。

## UI 约定

宿主只在左侧图标栏提供切换和导航，右侧全部内容空间由当前页面使用，没有宿主顶部导航、第二侧栏或底部状态栏。页面标题、工具栏和内部导航由插件自行组织。宿主提供主题和唯一 React 运行时。基础组件包括 `PageHeader`、`Panel`、`Button`、`Badge`、`Field`、`ModelSelect`、`EmptyState`。主题源文件 `src/theme.css` 随宿主全局加载，插件不重复引入 React 或全局 reset。

使用 `--m-bg`、`--m-surface`、`--m-text`、`--m-muted`、`--m-accent`、`--m-line`、`--m-radius`、`--m-font`。页面外层使用 `.m-page`；表单需可访问标签，操作需 loading / disabled / error 状态。业务 CSS 使用插件前缀，避免覆盖宿主或其他插件；manifest.styles 对应的 link 只在页面可见时生效，隐藏时停用，卸载时移除。第三方 CSS/assets 当前需自行复制到 dist。

宿主在根元素上设置 `data-theme="light|dark|system"`，浅色 / 深色即时切换；system 通过 `prefers-color-scheme` 跟随系统。插件继承同一套变量与 `color-scheme`，不维护独立主题偏好，不覆盖根元素属性。基础 UI 组件已自动适配。

自定义组件应使用语义变量：次级背景 `--m-surface-muted`、悬停背景 `--m-surface-hover`、次级文字 `--m-text-secondary`、占位符 `--m-placeholder`、弱分隔线 `--m-line-soft`、强调按钮文字 `--m-on-accent`。状态色使用 `--m-success` / `--m-warning` / `--m-error` 及相应 `-bg`、`-line` 变量。避免为正文、输入框或面板写死黑白色，完整 token 见 `src/theme.css`。

### 配色与密度基线

2026-10-03 用户提供 ChatGPT 桌面客户端设置页截图，要求协调侧栏与设置配色。当前采用截图中的中性灰层次，替代之前 VS Code 风格的蓝色强调；这是一套基于用户参考图的应用配色，不是 ChatGPT 官方设计规范。浅色主题使用同一套明度关系作对应适配。

| 用途 | 浅色 | 深色 |
| --- | --- | --- |
| 内容区 `--m-bg` | `#ffffff` | `#181818` |
| 设置菜单 `--m-surface-muted` | `#f3f3f3` | `#1e1e1e` |
| 卡片 `--m-surface` | `#f7f7f7` | `#232323` |
| 外侧图标栏 `--m-sidebar` | `#ebebeb` | `#292a2a` |
| 菜单选中 `--m-surface-hover` | `#e8e8e8` | `#303030` |
| 正文 `--m-text` | `#303030` | `#ededed` |
| 主操作 `--m-accent` | `#242424` | `#ededed` |
| 分隔 `--m-line` | `#e2e2e2` | `#363636` |

主按钮与图标背景若使用 `--m-accent`，前景必须配合 `--m-on-accent`，不能固定白色。选中、悬停、焦点和文本选区使用中性色，成功 / 警告 / 错误保留语义状态色。输入框使用 `--m-input-bg` / `--m-input-border`，焦点使用 `--m-focus`，次级按钮使用 `--m-button-secondary` / `--m-button-secondary-hover`。显式深色与跟随系统的深色使用相同 tokens。

保留之前参考 [VS Code 活动栏源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/activitybar/activitybarPart.ts) 选定的紧凑尺寸：活动栏宽 48px，36px 点击区域、20px 工具图标和 4px 项间距。活动项为中性高亮和明暗边缘指示。右侧由当前页面使用，无顶部导航；设置分类侧栏仅在设置内部出现。插件自己的品牌图标允许保留识别色。

## 独立构建与打包

在麻辣烫仓库下创建插件目录，开发依赖引用 workspace SDK（外部项目可先使用本地路径依赖）。

```sh
bun packages/sdk/build.ts /absolute/path/my-plugin
cd /absolute/path/my-plugin
bun pm pack
```

构建器把 `src/client.tsx` 和可选的 `src/backend.ts` 编译为对应 `dist` 文件。业务 JS 依赖被打包；React 与 JSX runtime 从宿主共享，插件无需访问宿主源码。不要把服务器代码导入前端。此 MVP 构建器尚未处理原生依赖和额外资源复制。

本地 `bun pm pack`、npm 发布包和 Git 仓库遵循同一个 manifest / dist 格式。Git 来源需要包含预构建 dist，宿主只获取依赖并禁用安装脚本，不替插件构建源码。页面或 CLI 安装后立即激活；前端渲染失败与后端激活失败分别显示。升级流程为卸载再安装，保留 KV 和历史；无自动升级 / 回滚。

### ChatGPT 订阅模型

`ModelInfo.kind` 增加 `chatgpt`，`chatgptProfileId` 是宿主账号引用；不包含邮箱、token 或授权 URL。模型固定绑定该账号，设置页切换账号不会改变已有模型。插件继续通过 `models.list/start` 调用，SDK 的 `ModelSelect` 自动显示订阅用量标识；自行绘制选择器时应同样标明使用 ChatGPT plan。宿主负责登录、实时模型目录、刷新、限额和退出，不会悄悄改用 API Key 计费。`configured: false` 表示需回设置恢复登录或订阅授权。

当前订阅模型仍使用 MVP 文本请求接口；宿主以官方 public Responses HTTP/SSE 发送 `instructions` 和输入，仅显式完成事件才算成功，断流保留部分文本但标为失败。其他 Pi provider 沿用现有 API Key 适配。
