# @semicoder/malatang-sdk · 0.2

SDK 0.2 是破坏性更新（包版本 0.2.0、manifest sdkVersion 0.2），需要麻辣烫 0.2.0 宿主；v0.1.0 不支持。包名为 `@semicoder/malatang-sdk`，由应用 CLI 内置归档提供，npm 发布状态独立核验，模板不依赖 registry 可安装性。插件为可信本地代码；SDK 命名空间用于组织数据，不是安全隔离。包内为 TypeScript / TSX 源码，使用 Bun 1.4.2 及以上构建插件，React 19 与 ReactDOM 19 为 peer dependency，开发依赖须精确同版本。发布流程见 [SDK npm 发布说明](https://github.com/potato47/malatang/blob/main/docs/npm-release.md)。

[麻辣烫官网](https://semicoder.dev/malatang) · [插件开发指南](https://semicoder.dev/malatang/docs/plugin-development) · [下载与安装](https://semicoder.dev/malatang/docs/installation)

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
    "sdkVersion": "0.2",
    "frontend": "dist/client.js",
    "styles": "dist/client.css",
    "backend": "dist/backend.js",
    "keepAlive": true
  }
}
```

`frontend: dist/client.js` 与 `styles: dist/client.css` 必需；存在 `src/backend.ts` 时声明 `backend: dist/backend.js`，否则省略。入口须在包内；浏览器资源放在 `dist/`，不通过资源路由公开后端入口。`id` 是 2–64 位小写字母、数字和连字符，首位为字母；`models` / `plugins` / `settings` 为宿主保留。ID 同时定义持久数据命名空间，勿随意更改。版本不兼容或重复 ID 会拒绝安装。

`keepAlive` 是可选布尔值，默认 `false`。仅需要保留页面实例的插件声明为 `true`；现有未声明的插件仍在切页时卸载。schemaVersion / sdkVersion 为 1 / 0.2。SDK 0.1 插件在新宿主中明确报错，需迁移源码并重新构建安装；KV、模型、账号和历史不清除。

## 前端

`src/client.tsx` 默认导出 React 组件：

```tsx
import { createPluginClient } from "@semicoder/malatang-sdk/client";
import { PageHeader, Button, Panel } from "@semicoder/malatang-sdk/ui";
const host = createPluginClient("my-plugin");
export default function Page() {
  return <Panel><PageHeader title="我的应用" />
    <Button onClick={() => host.kv.set("example", "hello")}>保存</Button>
  </Panel>;
}
```

能力：`models.list/start/onChange`、`runs.list/get/cancel/onChange`、`kv.get/set/delete`、`invoke(method,input)`、`onReconnect`。运行事件只通知变化，订阅后读取快照，重连时再次读取；UI 卸载时解除订阅。`runs.list` 返回最近 30 条摘要（输入输出最多各 300 字符），`runs.get` 返回完整状态。每个模型输出最多 64 KiB，输入/系统提示词各 16,000 字符，最长 180 秒，同时最多 8 次生成。

模型由宿主「设置 → 模型服务」管理。`ModelInfo.kind` 为 `openai-compatible`、`pi` 或 `chatgpt`；`preset` 为 Pi provider ID 或 null，`options` 为非密钥配置，`hasApiKey` 仅指是否已保存密钥，`configured` 不代表连通性已验证。没有配置时返回空列表，不再提供模拟模型；插件应提示配置并禁用生成。`ModelRun.demo` 仅兼容旧演示历史，新运行恒为 false。API 不返回密钥。插件仍使用宿主模型 `id` 调用，无需依赖 Pi 或选择协议。`models.onChange(listener)` 返回取消订阅函数；订阅后和重连时重读 `models.list()`，避免 keepAlive 页面缓存过期列表。

Pi 预设模型退出当前目录时，即使 `hasApiKey: true` 也会变为 `configured: false`；插件应提示回设置选择可用模型，不自动换用其他模型或服务商。宿主保留原配置、模型 ID 与历史。

KV 每值最多 64 KiB。不存在的键返回 null。读写只接受 JSON，值在宿主数据目录持久化。

### 页面生命周期

- 所有页面均首次访问才加载。`keepAlive: false` 时切走卸载，React effect cleanup 应释放订阅、定时器及页面资源；返回时重新初始化。
- `keepAlive: true` 时切走会关闭所有 SDK 弹层、释放其键盘监听且不向隐藏触发器恢复焦点；页面主体只隐藏，保留组件状态、DOM 与独立滚动位置；隐藏页面不参与布局、键盘导航和无障碍访问，effect 和事件订阅继续运行。此模式会持续占用内存，重页面应谨慎开启。
- 插件停用、卸载、后端激活状态失效，或版本 / 前端 / 样式资源 URL / keepAlive 声明变化时释放旧实例；重新启用后首次访问再创建。普通目录刷新、短暂连接失败不清空已保留的页面。
- 保留仅限当前窗口运行期间，无自动淘汰。刷新或重启不恢复未保存草稿，需持久化的数据继续使用 KV。翻译、随手记显式开启，应用中心与设置面板（含各设置分类）由宿主保留以避免切页丢失表单。
- 页面卸载不等于后端插件停用，不取消宿主模型任务，也不保证回收已导入的 JS 模块缓存或插件自行泄漏的全局对象。不要把“切页”当作任务取消信号。

`plugins.list` 返回归一化的 `keepAlive` 布尔值。已经安装的旧随手记归档不会被宿主隐式修改；SDK 0.1 插件需重新构建安装，卸载重装仍保留原有 KV。

## 可选后端

```ts
import { definePlugin, defineMethod, z } from "@semicoder/malatang-sdk/runtime";
export default definePlugin({
  methods: {
    generate: defineMethod("生成文本", z.object({ text: z.string(), modelId: z.string() }), (input, ctx) =>
      ctx.models.start({ modelId: input.modelId, prompt: input.text }))
  }
});
```

后端 `context` 提供 models 和 KV，`defineMethod` 生成用于发现的 JSON Schema 并在调用时校验输入。方法返回 JSON（最多 256 KiB），长任务调用 `models.start` 返回运行记录，勿长时间占用 `plugins.invoke`。`activate` / `dispose` 可用于短时初始化和资源释放；不要在激活期间启动模型。插件后台自建的长任务尚无宿主管理能力，首版不要绕过宿主创建常驻任务。模型运行或方法调用期间不允许停用 / 卸载。

## UI 约定

宿主拥有主题、48px 图标侧栏、React、JSX、ReactDOM 与 SDK UI。插件拥有完整内容页面，通过 `@semicoder/malatang-sdk/ui` 导入同一份实现；不重复打包 React、Radix 或公共样式。`ModelSelect` 使用宿主模型能力，与纯展示组件分开实现。

| 组件 | 主要约定 |
| --- | --- |
| Button / IconButton | variant 为 primary/secondary/ghost/danger；size 为 sm/md（28px/36px）；loading 同时禁用。IconButton 必填 label；Button 默认 type=button，表单提交显式 type=submit |
| Input / Select / Textarea | 继承原生属性与键盘语义；Input/Select 支持 sm/md；保留 required、disabled、aria-invalid |
| Field | label、hint、error；内放一个 SDK 控件，自动关联 id / htmlFor / aria-describedby；自定义 id 使用 Field.id |
| Checkbox / Switch | 原生复选框、button role=switch；Switch 使用 checked/onCheckedChange，Space/Enter 可操作 |
| Badge / Alert / Loading | tone 为 neutral/success/warning/error；Alert 具有 alert/status 语义；Loading 提供可访问 label |
| Page / PageHeader / Panel | 页面容器与标题；PanelHeader/PanelContent/PanelFooter 统一区域边距 |
| EmptyState / ModelSelect | 空状态；模型选择与 ChatGPT 用量入口 |
| Menu / Popover / Dialog / Tooltip | 基于 Radix，外观由 SDK 定义。trigger 使用 Button 等可转发 ref 的单个元素；Menu 子项使用 MenuItem；Dialog 必填 title、description；Tooltip 使用 children/content |

Menu/Popover/Dialog 支持 open/onOpenChange。宿主的 UIProvider 为每个页面建立可见性和 portal 作用域；嵌套作用域继承父页面隐藏状态。隐藏时关闭弹层，重新显示不会自行重开；卸载时移除 portal 与事件资源。插件无需自行添加 document 监听、焦点陷阱或 document.body 弹层。

公共颜色见 `src/theme.css`：`--m-bg`、`--m-surface`、`--m-text`、`--m-muted`、`--m-accent`、`--m-line`，以及 success/warning/error 的正文、背景和边框。几何 token 包括 `--m-space-1/2/3/4/6/8`、`--m-control-sm/md`、`--m-radius-sm/--m-radius/--m-radius-lg`、`--m-font/--m-font-size/--m-line-height`、`--m-shadow-popup`、`--m-motion`。宿主根元素管理 light/dark/system；插件不设置 data-theme。

业务样式放 `src/*.module.css`，通过导入的 class 映射使用。不得引用 `.m-*` 或宿主页面私有类，不引入 theme.css/ui.css，不写全局 reset、:root/:global/html/body 或重定义 `--m-*`。颜色默认使用语义 token；品牌图形/数据颜色可在 package.json 顶层 `malatangStyleExceptions` 声明文件路径及理由，其他约束不能豁免。宿主 check、插件 check/build/pack 都执行样式检查。CSS Modules 是一致性约束，不是安全沙箱。

CSS 中的相对 url 由 Bun 处理；JS 图片导入后用 `new URL(asset, import.meta.url).href`。构建自动输出 CSS 与资源，安装包需保留完整 dist。小型 CSS 图片可能被 Bun 内联。manifest stylesheet 只在页面可见时启用，卸载时移除。

## 插件开发 CLI（未发布）

应用自带已校验的 SDK 快照。创建项目复制到 `vendor/malatang-sdk.tgz`，以相对 `file:` 依赖消费，项目可移到 workspace 外；不依赖公开 npm SDK。

```sh
malatang plugin create ./my-notes --template notes --name 我的笔记
cd my-notes
bun install --ignore-scripts
malatang plugin check
malatang plugin build
malatang plugin pack
```

开发宿主使用 `bun run agent plugin …`。create 必须指定目标目录，模板为 notes（默认）或 model；ID 默认由目录生成，名称默认目录名，也可用 --id/--name 覆盖。拒绝无效 ID、保留名称、空名称与非空目录。不会自动安装依赖、初始化 Git 或安装插件。

check/build/pack 的目录默认调用者 cwd，支持含空格路径。开发者需安装 Bun >=1.4.2；CLI 使用该 Bun 和项目安装的 SDK 工具。生成的 `bun run check/build/pack` 调用同一实现。所有子命令有 --help/--json；诊断在 stderr，结果在 stdout。Ctrl-C 由 FIA 监督清理子进程；命令执行期间占用更新锁。

check 不改源码；build 先检查，再生成完整 dist，失败删除旧 dist 和半成品；pack 总是重新检查构建，只打包 manifest 与完整 dist，并解包校验资源。使用现有 `plugins.install` 安装归档，无热更新或自动发布。

notes 展示 Field、Textarea、保存状态、图片资源和 KV；model 展示空模型状态、ModelSelect、流式结果、取消、错误，以及卸载/重连时订阅清理。生成项目包含源码、CSS Modules、TS 配置、tools.ts、README、AGENTS.md 与 SDK 快照。

## 独立构建与打包

在麻辣烫仓库下创建插件目录，开发依赖引用 `"@semicoder/malatang-sdk": "workspace:*"`。外部项目可先安装本地 SDK 路径或经 `bun run npm:pack` 验收的 `.tgz`；实际发布后再使用对应 npm 版本。

```sh
bun packages/sdk/build.ts /absolute/path/my-plugin
cd /absolute/path/my-plugin
bun pm pack
```

外部项目可通过 SDK 的 build 入口编写 `build.ts`，再执行 `bun run build.ts`：

```ts
import { buildPlugin } from "@semicoder/malatang-sdk/build";
await buildPlugin(".");
```

构建器把 `src/client.tsx` 和可选的 `src/backend.ts` 编译为对应 `dist` 文件。业务 JS 依赖被打包；React 与 JSX runtime 从宿主共享，插件无需访问宿主源码。不要把服务器代码导入前端。此 MVP 构建器尚未处理原生依赖和额外资源复制。

本地 `bun pm pack`、npm 发布包和 Git 仓库遵循同一个 manifest / dist 格式。Git 来源需要包含预构建 dist，宿主只获取依赖并禁用安装脚本，不替插件构建源码。页面或 CLI 安装后立即激活；前端渲染失败与后端激活失败分别显示。升级流程为卸载再安装，保留 KV 和历史；无自动升级 / 回滚。

### ChatGPT 订阅模型

`ModelInfo.kind` 增加 `chatgpt`，`chatgptProfileId` 是宿主账号引用；不包含邮箱、token 或授权 URL。模型固定绑定该账号，设置页切换账号不会改变已有模型。插件继续通过 `models.list/start` 调用，SDK 的 `ModelSelect` 自动显示订阅用量标识；自行绘制选择器时应同样标明使用 ChatGPT plan。宿主负责登录、实时模型目录、刷新、限额和退出，不会悄悄改用 API Key 计费。`configured: false` 表示需回设置恢复登录或订阅授权。

当前订阅模型仍使用 MVP 文本请求接口；宿主以官方 public Responses HTTP/SSE 发送 `instructions` 和输入，仅显式完成事件才算成功，断流保留部分文本但标为失败。其他 Pi provider 沿用现有 API Key 适配。
