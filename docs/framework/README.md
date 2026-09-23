# FIA 4 框架契约

FIA 只支持一种架构：预编译 Swift Host + 必选 Bun + WebView。Swift 源码仅用于框架维护，不作为应用依赖。

## 进程与通信

Host 是 `.app` 的入口，负责 NSApplication、窗口、原生服务、Bun 进程组和代码更新。Bun 是唯一 HTTP/WebSocket 服务；开发时 Vite 代理 `/api`、`/_fia` 到 Bun，生产时 Bun 直接提供静态资源。

Host 与 Bun 使用 stdio protocol 5，JSON Lines，stdout 只能输出协议；框架入口将 console 日志重定向到 stderr。初始化携带会话、进程代次、应用数据目录和代码目录。`listening` 表示 HTTP 已监听；业务 `start` 完成后才报告 `ready`。请求支持 ID、事件、取消、超时和 128 个并发上限，帧大小上限 1 MiB。进程代次隔离，退出回收整个受管进程组。

前端与 Bun 的 Native SDK 使用 WebSocket protocol 1。系统 API 的实现仍在 Swift，Bun 只转发。Native WebSocket 与业务 WebSocket 共用一个 Bun 服务。`/_fia` 是保留路径，业务路由相对 `/api` 声明。HTTP/SSE 直接返回标准 Response，不缓冲完整响应。

会话通过一次性 HMAC 引导票据建立 HttpOnly、SameSite=Strict Cookie；HTTP/WS 检查会话和 Origin，服务只监听 127.0.0.1。框架私有方法不能从前端 RPC 调用。截图等原生资源只在 stdio 中返回描述符，Bun 验证资源路径后流式读取受控临时文件。

## 共享 API 与 agent

`shared/api.ts` 的默认导出使用 `defineAPI({methods, events})`；Zod 4 schema 同时决定类型、运行时校验和生成的 JSON Schema。方法声明 description/input/output 与可选 examples；事件声明 description/payload。只允许 JSON 值；日期、BigInt、输出 transform 等不可表示的 schema 构建时报错。不要在契约模块初始化数据库或启动后台服务。

后端通过 `api: implementAPI(contract, handlers)` 注册实现；框架启动时验证它与构建契约一致。`http` 可选。调用上下文包含 native、app、emit、source（ui/cli/script）、requestId、sessionId 和 signal。每个方法只定义一个实现，UI、CLI 和脚本调用同一分发器。方法输入和返回值、事件 payload 都必须通过 schema 校验。调用并发上限 128，JSON 消息上限 1 MiB。应用开发者应让长操作响应 signal；取消不撤销已经完成的副作用。

浏览器 `createClient<typeof api>()` 提供 call/on/onReconnect/close。HTTP 入口为受 WebView 会话保护的 `/_fia/api`；CLI 使用 HTTP over Unix Socket 和独立 token，不接触内部 stdio 会话密钥。发现记录位于应用数据同级的 Agent/instance.json，目录 0700、记录和 socket 0600。连接核对应用标识、实际 bundle 路径、runtimeId、协议与进程代次。生产实例与各开发项目的数据目录和 socket 分离。

事件流不保留历史；首次建立和重新建立订阅时触发 onReconnect，客户端应重新读取状态。在途业务调用不自动重放；网络错误可能返回 execution_unknown。框架不提供业务数据库、持久任务或资源所有权模型。

CLI 命令：help、schema --json、call METHOD --json JSON、events EVENT --jsonl、exec、open、status --json、quit、install、uninstall、skill install。安装为显式操作，CLI 默认 ~/.local/bin，skill 默认 ~/.agents/skills；都可用 --dir 指定目标。不会修改 shell 配置，不覆盖其他命令或 skill。应用菜单和 native.agent.installCLI/status/uninstallCLI 使用相同安装实现。移动 .app 后重新安装入口即可修复。

exec 支持 --file FILE、-e CODE 或 stdin，注入 app SDK 和 help。独立 Bun 子进程保留调用 cwd，文件入口的相对 import 按原文件路径解析。默认超时 60000 毫秒，可用 --timeout 覆盖，0 禁用。脚本可使用本机文件、网络和已有依赖，禁用自动依赖安装。不是安全沙箱，不保留跨执行变量。Ctrl-C、超时、应用断开或监督进程终止会清理受管脚本及其子进程。退出码：0 成功，1 执行失败，2 参数错误，75 连接/更新状态需处理，124 超时，130 取消。exec --jsonl 将 stdout/stderr、完成状态和监督错误转换为事件流。后台启动错误记录在用户私有目录中，CLI 返回 startup_failed，status --json 在未运行时保留具体错误信息。

构建生成 agent/<command>/SKILL.md、references/api.md、schema.json 和 agent.d.ts；所有内容进入代码更新签名。Agent/current 稳定链接仅在启动或候选提交后指向生效版本，已安装 skill 通过该链接随应用升级和回退。框架生成的 skill 不自动授予工具权限。

## TypeScript 配置与窗口

`agent.command` 和 `agent.description` 为必填；`api.entry` 默认 `shared/api.ts`，`agent.instructions` 为可选业务说明 Markdown。

`defineConfig` 从 `@semicoder/fia/config` 导入。`app` 包含 name、identifier、version、递增 build 和可选 icon。后端默认入口 `backend/index.ts`；前端默认 root=`frontend`、dist=`frontend/dist`。系统权限说明直接使用 Info.plist 的 `NS…UsageDescription` 键。可选 `statusItem` 配置菜单栏图标；这不会改变应用模式。

窗口默认 main、1000×720、标准标题栏、红绿灯和下方 WKWebView。`create` 不隐式显示，使用 `open/focus` 呈现；普通前台启动自动显示 main，CLI 启动只保留配置的 tray。窗口 ID 稳定，`create` 对已有 ID 同步声明并复用，保留尺寸与打开/隐藏/关闭状态；关闭后 `open` 可恢复。新增窗口只接受应用内 route。`update` 可显式修改 route、title、width、height、titlebar。最小化、最大化、恢复、全屏、focus/hide/close 统一由 `native.windows` 提供。

标题栏 items 为 button、text、spacer；每项都有唯一 id，button/text 有 label，按钮可指定 SF Symbol、tooltip、enabled。`setTitlebar({id, items})` 更新整个声明。点击产生 `windows.titlebarAction`，携带 windowId 和 itemId。回调留在 TS，禁止序列化函数或插入 Swift/HTML 标题栏。

WebView 默认关闭页面视口横向、纵向的边缘拉伸回弹，保留正常内容滚动和嵌套滚动区域。该默认行为由宿主在每次文档加载时设置，覆盖加载页、页面跳转和子框架，不要求业务添加 CSS。

后端重启期间窗口显示宿主内置加载页并禁用标题栏按钮；恢复后加载新页面。后端 start 应幂等地绑定监听器和声明控件。普通关窗不退出应用，Dock 点击恢复 main。

## 构建与代码更新

固定运行时包含 Host、通用 CLI 客户端和 Bun 1.4.2；代码版本包含 `backend/index.js`、`web/index.html` 和依赖资源。业务数据使用 `context.app.dataDirectory`，不能写入代码目录。

需要按路径读取的业务资源可在 `backend.assets` 声明项目相对路径；`context.app.codeDirectory` 在开发时指向项目根目录，生产时指向包含这些资源的代码目录，保持相同相对路径。例如配置 `assets: ["assets/model.wasm"]` 后，使用 `Bun.file(context.app.codeDirectory + "/assets/model.wasm")`。普通模块依赖由 Bun bundler 打包。

完整安装包经 codesign、Developer ID、公证、staple 和 Gatekeeper 验证。代码更新不改动已签名 `.app`。应用运行不依赖系统安装的 Bun。

更新清单是 `{payload, signature}`：payload 为原始 JSON 字节的 Base64，signature 为 Ed25519 签名的 Base64。payload 包含 schema=1、identifier、version、build、runtimeId、HTTPS baseURL、可选 downloadURL 和 files（path、size、sha256）。公钥固定在安装包，私钥只用于发布。清单及文件限制由宿主校验，禁止路径穿越、符号链接、大小越界和原生可执行文件。

`runtimeId` 由框架根据预编译运行时与原生配置计算，不由业务手填。更新必须与已安装运行时匹配；运行时或权限变化显示安装包下载信息。首版代码包支持 Bun 可 bundle 的 JS/TS、静态资源及 WASM，不支持业务自带 `.node`、dylib 或外部原生可执行文件；这些能力需要新的完整运行时分发。

配置更新源后，启动和每 24 小时检查。完整下载后在有可见窗口时提示“Update Now / Later”，后台不弹出更新窗口；Later 只保留候选版本，不会自动切换。手动使用 `native.updates.check/download/apply/state`；Check for Updates 菜单提供同样流程。

更新目录位于 `Application Support/<identifier>/Updates`。应用持有排他锁，版本文件和状态日志分开持久化。确认后先禁止新 API 调用，检查在途调用和脚本以及可选 beforeUpdate 钩子。有活动执行时返回 update_busy，保留候选并恢复接收；钩子可返回 {ready:false, reason} 阻止应用后台任务被中断。检查通过后记录 pending，再停止旧后端、启动候选并统一刷新所有窗口。切换和观察期间 CLI 返回 updating，提交后重新握手。15 秒内需完成 Bun start、HTTP 健康检查、前端就绪；随后观察 30 秒，成功才提交 active。无可见窗口时隐藏加载 WebView 完成前端验证，不弹窗也不省略前端检查。模板在 React 首次挂载后调用 `native.ready()`，自定义入口也必须报告就绪。

下载/验证失败不切换代码；启动或观察失败恢复上一版。应用在 pending 阶段异常退出，下次启动标记该版本失败并恢复稳定版本。拒绝远程降级，不反复自动重试失败版本；内置出厂版本始终保留。数据不回滚，数据库迁移必须向后兼容。健康检查不能证明所有业务操作正确。

## 验证

`bun run check` 覆盖 TS 检查、真实 HTTP/WS/SSE、stdio 取消与进程组清理、窗口 ID 和标题栏、Ed25519 与文件完整性、更新日志恢复，以及真实 Bun + WKWebView 的升级、30 秒观察、后端崩溃和首屏未就绪回退。运行前需要 `runtime:build` 和 `cli:build`。

`bun run smoke` 使用本地依赖创建实际应用，构建时禁止 Swift 调用，检查图标生成、生产首屏就绪、正常退出、进程组回收和签名代码更新产物；还验证并发 CLI 冷启动、后台开窗语义、持久计数器并发修改、TypeScript 执行、临时 CLI/skill 安装与卸载和签名保持；开发会话验证 React Fast Refresh、双窗口、后端重启、fia agent 重连和停止钩子。Developer ID 公证验收需要发布者配置证书和 Keychain profile。
