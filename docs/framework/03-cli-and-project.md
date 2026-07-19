# 项目结构、配置与 CLI

## 1. 阶段 1 项目结构

`fia create hello` 当前生成以下 React/Bun 项目：

```text
hello/
├── fia.config.ts
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
└── src/
    ├── server.ts
    └── ui/
        ├── index.html
        ├── main.tsx
        ├── App.tsx
        └── style.css
```

后续 `fia dev/run/build` 产生的文件统一放在 `.fia/`，正式应用产物放在 `dist/`；两者默认
加入 `.gitignore`。图标、状态栏资源和 `native/` 属于后续增量，不在首版模板中公开。

## 2. 公共配置模型

项目从 `@fia/cli/config` 导入类型安全入口：

```ts
import { defineConfig } from "@fia/cli/config";

export default defineConfig({
  configVersion: 1,
  app: {
    name: "My App",
    identifier: "com.example.my-app",
    version: "0.1.0",
    quitOnLastWindowClosed: true,
  },
  entry: "src/server.ts",
  window: {
    width: 1024,
    height: 700,
    minWidth: 720,
    minHeight: 480,
  },
});
```

只有 `configVersion`、`app.name` 和 `app.identifier` 必填。其余阶段 1 默认值为：

- `app.version`: `0.1.0`
- `app.quitOnLastWindowClosed`: `true`
- `entry`: `src/server.ts`
- 窗口：`1024 × 700`，最小 `720 × 480`

CLI 只读取当前目录的 `fia.config.ts`。配置必须默认导出普通对象，未知字段在每一层都报错；
bundle identifier 使用 reverse-DNS 格式，版本使用数字 `X.Y.Z`。入口必须是配置目录内的
相对路径并指向可读文件。配置版本不兼容时 MVP 直接失败，不自动迁移。

公共 `configVersion` 与应用包内的阶段 0 `fia-config.json.schemaVersion` 是不同边界。后者
仍是 Host 的内部输入，不出现在公共配置类型中。状态栏、置顶、vibrancy 等阶段 2 字段
目前会按未知字段拒绝，避免接受但不生效的配置。

## 3. `fia create`

```bash
fia create hello
fia create hello --no-install
fia create hello --git
```

名称必须是单段小写 kebab-case。CLI 在当前目录生成同名项目，将 `hello-world` 转换为显示名
`Hello World` 和占位 bundle identifier `com.example.hello-world`。已有目标一律拒绝，不提供
覆盖选项。

生成过程在目标旁的临时目录完成。默认先写入模板并运行 `bun install`；`--git` 额外执行
`git init`。所有步骤成功后才原子移动到目标位置，失败会清理临时目录。`--no-install`
用于离线、测试或当前仓库内尚未发布 `@fia/cli` 的开发场景。

## 4. React 模板的当前边界

模板使用 React 19 和 Bun 1.3.14 full-stack HTML route：

- `/` 提供 React 页面与 HMR 资源。
- `/api/hello` 展示普通 HTTP JSON 请求。
- `/ws` 展示应用级 WebSocket Echo。
- `bun run dev` 以 `bun --hot` 启动直接开发服务器。
- `bun run typecheck` 执行严格 TypeScript 检查。

直接 `Bun.serve` 是有意选择的过渡实现，只用于当前浏览器开发闭环。它不包含阶段 0 Host
协议的一次性 bootstrap token、会话 cookie、control token、stdin 生命周期或退出回收，
也不定义长期 Runtime RPC API。实现 `fia dev/run/build` 时必须迁移到 FIA 托管的 Runtime
入口，不能把当前 `/ws` 消息格式当作稳定协议。

## 5. 后续 CLI 闭环

阶段 1 后续仍需实现：

- `fia dev`：组装临时 `.app`，由 Host 启动带 HMR 的 FIA Runtime 并聚合日志。
- `fia run`：使用生产启动协议运行未发布的本地 `.app`。
- `fia build`：编译 runtime、消费预编译 Host、组装并 ad-hoc 签名 `.app`。

目标进程所有权保持不变：生产和 FIA 开发模式均由 Swift Host 拥有 Bun runtime，CLI 退出
后通过 Host 生命周期链路回收 runtime，不允许残留后台进程。
