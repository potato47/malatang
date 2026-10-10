# @semicoder/malatang-sdk · 开发契约 0.3

本仓库的未发布开发版本使用 **Base UI 1.9 + Tailwind CSS 4.3**，manifest `sdkVersion` 为 `0.3`。应用与 SDK 包版本字符串暂未递增；它们不代表本地源码等同于公开麻辣烫 0.4.0 / SDK 0.2.1。使用开发宿主内置快照创建插件，不从当前公开 npm 安装新契约。

插件为可信本地代码，命名空间和 CSS 作用域不是安全沙箱。使用 Bun >=1.4.2；React 与 ReactDOM 19 必须精确同版本。宿主提供唯一的 React、Base UI 和公共组件实现。此轮不提供旧 API 或插件兼容层，数据存储键保持不变。

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
    "sdkVersion": "0.3",
    "frontend": "dist/client.js",
    "styles": "dist/client.css",
    "backend": "dist/backend.js",
    "keepAlive": true
  }
}
```

`frontend: dist/client.js` 与 `styles: dist/client.css` 必需；存在 `src/backend.ts` 时声明 `backend: dist/backend.js`，否则省略。入口须在包内；浏览器资源放在 `dist/`，不通过资源路由公开后端入口。`id` 是 2–64 位小写字母、数字和连字符，首位为字母；`models` / `plugins` / `settings` 为宿主保留。ID 同时定义持久数据命名空间，勿随意更改。版本不兼容或重复 ID 会拒绝安装。

`keepAlive` 是可选布尔值，默认 `false`。仅需要保留页面实例的插件声明为 `true`；现有未声明的插件仍在切页时卸载。schemaVersion / sdkVersion 为 1 / 0.3。KV、模型、账号和历史不清除。

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

`plugins.list` 返回归一化的 `keepAlive` 布尔值。已经安装的旧随手记归档不会被宿主隐式修改；插件须使用当前开发契约构建，卸载重装仍保留原有 KV。

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

统一从 `@semicoder/malatang-sdk/ui` 导入；宿主拥有主题、48px 侧栏和共享实现。插件不直接依赖 Base UI、Lucide 或宿主私有类。需要的图标也从 UI 入口导入。

| 分类 | 组件 |
| --- | --- |
| 基础与表单 | Button、IconButton、Input、Textarea、SearchInput、InputGroup、Field、Checkbox、RadioGroup/Radio、Switch、NumberField、Slider、Select、Combobox |
| 布局 | Page、PageHeader、Panel/Header/Content/Footer、SettingsGroup/SettingsRow、Tabs/List/Trigger/Content、Accordion/Item/Trigger/Content、Separator、ScrollArea |
| 浮层 | Dialog、AlertDialog、Popover、Tooltip、Menu、ContextMenu；配套 Trigger/Content、标题、描述、关闭与页脚；菜单支持分组、勾选、单选和子菜单 |
| 反馈 | Alert、Badge、Loading、EmptyState、Skeleton、Progress、Avatar、Kbd、useToast |
| 业务 | ModelSelect：搜索和服务商分组、不可用模型及订阅用量入口 |

Button 默认 `type="button"`；variant 为 primary/secondary/ghost/danger，size 为 sm/md/lg（28/36/40px），loading 同时禁用。IconButton 必填 label。Input 保留原生事件；Select/Combobox 使用 `value/onValueChange`，Checkbox/Switch 使用 `checked/onCheckedChange`。Field 内放一个控件，自动关联标签、说明和错误；组合选择控件的关联落在 Trigger/Input。

```tsx
import { Button, Dialog, DialogTrigger, DialogContent, DialogTitle,
  DialogDescription, DialogFooter, DialogClose, Field, Input,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  useToast } from "@semicoder/malatang-sdk/ui";

export function Example() {
  const toast = useToast();
  return <Dialog>
    <DialogTrigger render={<Button />}>编辑</DialogTrigger>
    <DialogContent>
      <DialogTitle>编辑内容</DialogTitle>
      <DialogDescription>更改当前页面的显示设置。</DialogDescription>
      <Field label="名称"><Input /></Field>
      <Field label="语言"><Select defaultValue="zh">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="zh">中文</SelectItem>
          <SelectItem value="en">English</SelectItem></SelectContent>
      </Select></Field>
      <DialogFooter><DialogClose render={<Button variant="secondary" />}>取消</DialogClose>
        <Button onClick={() => toast.add({ title: "保存完成" })}>保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
```

浮层支持 `open/onOpenChange`；使用 `render` 组合元素，自定义触发器须透传 props 和 ref。Popup 定位参数放在 Content：side、align、sideOffset、collisionPadding。SelectContent 默认与触发器同宽；Select 可通过 `items` 显式提供显示标签，也会读取直接组合的 SelectItem 标签。ModelSelect 使用字符串模型 ID、`onValueChange(id)`。

宿主 UIProvider 建立 Portal、通知和可见性作用域。隐藏页面关闭浮层、取消通知；恢复时不重开，不向隐藏触发器恢复焦点。插件不要将浮层放入 document.body；使用 SDK 的 Content。Toast 由 `useToast().add({title, description})` 发起，Provider 自动渲染并清理。

## Tailwind 与局部样式

模板的 `src/styles.css` 仅包含以下入口，由 CLI 处理；不要直接导入 Tailwind 全局 reset：

```css
@import "@semicoder/malatang-sdk/tailwind.css";
```

```tsx
import "./styles.css";
// 类名必须完整、静态可扫描；不要拼接 `p:bg-${tone}`。
<div className="p:flex p:gap-4 p:rounded-xl p:bg-surface p:text-foreground">内容</div>
```

CLI 只扫描本插件 src，在构建阶段编译 `p:` 工具类。宿主使用普通类，SDK 内部使用 `ui:`。语义颜色包括 background/surface/hover/popup/foreground/muted/border/primary/on-primary/error/success/warning/focus。基础值由 `--m-*` token 提供，light/dark/system 共用几何与字体。

复杂局部样式仍用 `.module.css` 与语义 token；禁止全局选择器、主题重定义、引用 `.m-*`/`ui:` 私有类或导入公共 CSS。品牌/数据颜色可用 `malatangStyleExceptions` 按 CSS 文件注明理由。插件工具类不要使用任意颜色覆盖公共视觉。

编译结果按插件 ID 作用域化；Tailwind 内部变量、`@property` 与动画名也隔离。不要在 JS 中引用编译器内部变量或动画名。页面和 Portal 具有相同作用域；样式仅在页面可见时启用，卸载时移除。宿主只加载一次 Preflight 和公共 UI CSS，运行时不编译 Tailwind。

CSS 相对 url 由 Bun 处理；JS 图片使用 `new URL(asset, import.meta.url).href`。安装包保留完整 dist。SDK 归档内 `ui.css` 已预编译，`tailwind.css` 只是构建映射，不能作为插件全局样式注入。

## 插件开发 CLI

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

### 自定义主题继承（未发布）

宿主可在运行时覆盖 `--m-*` 配色，分别保存浅色和深色主题；`theme.css` 提供默认值，`tailwind.css` 的语义工具类引用这些变量。SDK 组件、插件页面及同作用域 Portal 自动继承，不需重新构建。插件不得重定义主题 token；固定品牌色和数据颜色仍使用明确的样式例外。主题设置和预览由宿主管理，原生标题栏只跟随明暗模式。
