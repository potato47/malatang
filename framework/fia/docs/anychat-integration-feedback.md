# 上游反馈与集成记录

记录日期：2026-09-06。应用基准：dsh 0.1.2-rc.1；本地参考源码为 0.1.3-alpha.1，接口不完全相同。

## FIA：SSE 响应被缓冲（已修复）

- 复现：Bun 返回 `text/event-stream` 并分两次写入，第二次延迟 31 秒。原 Gateway 使用 `URLSession.data(for:)`，首块不能及时到达，并受 30 秒请求超时影响。
- 修复：SSE 专用增量响应体；按换行或 16 KiB 输出并等待 NIO 写入；普通响应继续保留 8 MiB 限制。请求空闲超时为 300 秒，长流由心跳维持。
- 断开根因：NIO HTTP pipelining helper 在响应未结束时暂停 socket read，无法及时发现客户端 FIN。SSE 独占当前连接，移除该 helper 并恢复读取，后续请求关闭连接；流结束关闭连接。取消显式传给上游 URLSessionDataTask 和 session。
- 验证：`swift test --filter GatewaySecurityTests`，10 项通过；包含首块小于 3 秒、第二块延迟 31.1 秒、客户端取消释放上游、原有普通接口与 WebSocket 回归。
- 上游文件：`Sources/FIAWeb/FIAGateway.swift`、`Tests/FIATests/GatewaySecurityTests.swift`。

## FIA：Vite 代理误匹配前端模块（已修复）

- 复现：前端存在 `api.ts`，Vite 发起 `/api.ts` 模块请求；字符串 `/api` 代理规则将其送入后端，返回 404，应用空白。
- 修复：代理 key 使用转义后的路径边界正则，只匹配 mount 本身、子路径或查询串。同样修正 `/_fia`；自定义 mount 中的正则字符按字面匹配。
- 验证：`bun test packages/cli/tests/vite.test.ts` 通过，覆盖 `/api`、`/api/chats`、`/api?x=1`、`/api.ts`、`/apiary`、自定义带点路径；实际 React 开发界面正常加载。

## agent-webtool：进程级来源表无法隔离会话（已修复）

- 复现：两个会话共享 Bun 进程，原全局来源编号跨会话累积，清空全局来源还会影响在途请求。
- 修复：新增 `createSourceContext(initial?)`、`SourceContext.snapshot()`，由 SDK 的第二个参数 `sources` 传入。引用编号在上下文内分配，可用持久化快照恢复；旧的全局 API 保持兼容。
- 同时修复：网页缓存命中时仍需登记当前会话来源；已取消的请求在缓存命中之前拒绝，避免取消后写入来源。
- 验证：`bun test test/` 72 项通过；独立来源、并发调用、恢复编号、缓存来源登记、取消和旧 API 均覆盖。Anychat 双会话并行工具测试通过。
- 上游文件：`src/core/search.ts`、`src/core/fetch.ts`、`src/index.ts`、`test/source-context.test.ts`。

## dsh：编译后的动态 package.json 读取失败（应用依赖补丁）

- 复现：`fia build` 成功，但独立启动打包的 `FIABackend` 报 `Cannot find module '../package.json' from '/$bunfs/root/FIABunBackend'`。
- 原因：`@deepseek-ai/dsh-llm` 使用 `createRequire(import.meta.url)("../package.json")` 读取 attribution 版本，Bun 无法静态纳入该 JSON。
- 修复：通过 Bun patchedDependencies 将唯一一处运行时读取改为静态 JSON import；原版本与其他逻辑保持不变。补丁在 `patches/`，安装时自动应用。
- 验证已通过：`bun scripts/smoke-packaged.ts`，将子进程 PATH 限为 `/usr/bin:/bin`，使用真实打包后端完成启动、模型目录、模拟流式对话、持久化和删除。

## 边界与未实测项

- 自有上游修改保留在本地工作区，未提交、未发布；agent-webtool 的 SDK dist 已重建。
- dsh JSONL 实现的 fs-ext/koffi 未引入。固定发布版持久化采用 `PersistenceCoordinator` 接口，和本地新版 SessionHandle 接口不同，不能直接混用。
- 后端运行产物不依赖 Node 或 `.node` 扩展。React/Vite/Tailwind 构建工具及本地 agent-webtool 开发依赖仍含平台构建插件，它们不进入 agent 运行时。
- OAuth 已接入发布版的所有授权流程与凭据存储；自动化测试覆盖交互提示、提交和取消。未逐一登录真实 OAuth 账号，也未对每个提供商进行真实 token 刷新测试。

- 真实连接：DeepSeek `deepseek-v4-flash` 使用已有环境凭据完成 `web_fetch(https://example.com/)`，工具成功且来源入库；其他真实提供商未逐一测试。

## FIA：代码签名后后端哈希失效（已修复）

- 复现：直接运行打包后端成功，但启动正式 .app 后 /api 持续 503。RuntimeManifest 的 SHA256 与 Helpers/FIABackend 实际文件不同。
- 原因：CLI 先计算哈希再执行 codesign；签名修改可执行文件，BackendSupervisor 完整性校验拒绝启动。
- 修复：先签名后端，再计算哈希写入 manifest，最后签名外层应用；保留完整性校验。
- 验证：application.test.ts 增加模拟签名修改字节的回归测试，在外层签名时验证 manifest 哈希。application + vite 共 5 项、28 断言通过。
- 上游文件：packages/cli/src/application.ts、packages/cli/tests/application.test.ts。
