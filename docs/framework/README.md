# FIA 3 框架契约

FIA 只支持一种架构：预编译 Swift Host + 必选 Bun + WebView。Swift 源码仅用于框架维护，不作为应用依赖。

## 进程与通信

Host 是 `.app` 的入口，负责 NSApplication、窗口、原生服务、Bun 进程组和代码更新。Bun 是唯一 HTTP/WebSocket 服务；开发时 Vite 代理 `/api`、`/_fia` 到 Bun，生产时 Bun 直接提供静态资源。

Host 与 Bun 使用 stdio protocol 4，JSON Lines，stdout 只能输出协议；框架入口将 console 日志重定向到 stderr。初始化携带会话、进程代次、应用数据目录和代码目录。`listening` 表示 HTTP 已监听；业务 `start` 完成后才报告 `ready`。请求支持 ID、事件、取消、超时和 128 个并发上限，帧大小上限 1 MiB。进程代次隔离，退出回收整个受管进程组。

前端与 Bun 的 Native SDK 使用 WebSocket protocol 1。系统 API 的实现仍在 Swift，Bun 只转发。Native WebSocket 与业务 WebSocket 共用一个 Bun 服务。`/_fia` 是保留路径，业务路由相对 `/api` 声明。HTTP/SSE 直接返回标准 Response，不缓冲完整响应。

会话通过一次性 HMAC 引导票据建立 HttpOnly、SameSite=Strict Cookie；HTTP/WS 检查会话和 Origin，服务只监听 127.0.0.1。框架私有方法不能从前端 RPC 调用。截图等原生资源只在 stdio 中返回描述符，Bun 验证资源路径后流式读取受控临时文件。

## TypeScript 配置与窗口

`defineConfig` 从 `@semicoder/fia/config` 导入。`app` 包含 name、identifier、version、递增 build 和可选 icon。后端默认入口 `backend/index.ts`；前端默认 root=`frontend`、dist=`frontend/dist`。系统权限说明直接使用 Info.plist 的 `NS…UsageDescription` 键。可选 `statusItem` 配置菜单栏图标；这不会改变应用模式。

窗口默认 main、1000×720、标准标题栏、红绿灯和下方 WKWebView。窗口 ID 稳定，`create` 对已有 ID 同步声明并复用，保留尺寸与打开/隐藏/关闭状态；关闭后 `open` 可恢复。新增窗口只接受应用内 route。`update` 可显式修改 route、title、width、height、titlebar。最小化、最大化、恢复、全屏、focus/hide/close 统一由 `native.windows` 提供。

标题栏 items 为 button、text、spacer；每项都有唯一 id，button/text 有 label，按钮可指定 SF Symbol、tooltip、enabled。`setTitlebar({id, items})` 更新整个声明。点击产生 `windows.titlebarAction`，携带 windowId 和 itemId。回调留在 TS，禁止序列化函数或插入 Swift/HTML 标题栏。

WebView 默认关闭页面视口横向、纵向的边缘拉伸回弹，保留正常内容滚动和嵌套滚动区域。该默认行为由宿主在每次文档加载时设置，覆盖加载页、页面跳转和子框架，不要求业务添加 CSS。

后端重启期间窗口显示宿主内置加载页并禁用标题栏按钮；恢复后加载新页面。后端 start 应幂等地绑定监听器和声明控件。普通关窗不退出应用，Dock 点击恢复 main。

## 构建与代码更新

固定运行时包含 Host 和 Bun 1.4.1；代码版本包含 `backend/index.js`、`web/index.html` 和依赖资源。业务数据使用 `context.app.dataDirectory`，不能写入代码目录。

需要按路径读取的业务资源可在 `backend.assets` 声明项目相对路径；`context.app.codeDirectory` 在开发时指向项目根目录，生产时指向包含这些资源的代码目录，保持相同相对路径。例如配置 `assets: ["assets/model.wasm"]` 后，使用 `Bun.file(context.app.codeDirectory + "/assets/model.wasm")`。普通模块依赖由 Bun bundler 打包。

完整安装包经 codesign、Developer ID、公证、staple 和 Gatekeeper 验证。代码更新不改动已签名 `.app`。应用运行不依赖系统安装的 Bun。

更新清单是 `{payload, signature}`：payload 为原始 JSON 字节的 Base64，signature 为 Ed25519 签名的 Base64。payload 包含 schema=1、identifier、version、build、runtimeId、HTTPS baseURL、可选 downloadURL 和 files（path、size、sha256）。公钥固定在安装包，私钥只用于发布。清单及文件限制由宿主校验，禁止路径穿越、符号链接、大小越界和原生可执行文件。

`runtimeId` 由框架根据预编译运行时与原生配置计算，不由业务手填。更新必须与已安装运行时匹配；运行时或权限变化显示安装包下载信息。首版代码包支持 Bun 可 bundle 的 JS/TS、静态资源及 WASM，不支持业务自带 `.node`、dylib 或外部原生可执行文件；这些能力需要新的完整运行时分发。

配置更新源后，启动和每 24 小时检查。完整下载后提示“Update Now / Later”；Later 只保留候选版本，不会自动切换。手动使用 `native.updates.check/download/apply/state`；Check for Updates 菜单提供同样流程。

更新目录位于 `Application Support/<identifier>/Updates`。应用持有排他锁，版本文件和状态日志分开持久化。确认后先记录 pending，再停止旧后端、启动候选并统一刷新所有窗口。15 秒内需完成 Bun start、HTTP 健康检查、前端就绪；随后观察 30 秒，成功才提交 active。模板在 React 首次挂载后调用 `native.ready()`，自定义入口也必须报告就绪。

下载/验证失败不切换代码；启动或观察失败恢复上一版。应用在 pending 阶段异常退出，下次启动标记该版本失败并恢复稳定版本。拒绝远程降级，不反复自动重试失败版本；内置出厂版本始终保留。数据不回滚，数据库迁移必须向后兼容。健康检查不能证明所有业务操作正确。

## 验证

`bun run check` 覆盖 TS 检查、真实 HTTP/WS/SSE、stdio 取消与进程组清理、窗口 ID 和标题栏、Ed25519 与文件完整性、更新日志恢复，以及真实 Bun + WKWebView 的升级、30 秒观察、后端崩溃和首屏未就绪回退。运行前需要 `runtime:build` 和 `cli:build`。

`bun run smoke` 使用本地依赖创建实际应用，构建时禁止 Swift 调用，检查图标生成、生产首屏就绪、正常退出、进程组回收和签名代码更新产物；还验证双窗口开发会话中的 React Fast Refresh、后端重启和停止钩子。Developer ID 公证验收需要发布者配置证书和 Keychain profile。
