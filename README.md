# 麻辣烫 · Malatang

基于 FIA 的本地插件应用平台。宿主提供模型、存储和统一界面组件，独立插件组合这些能力，拥有自己的应用页面。

## 运行

需要 macOS / Apple Silicon 与 Bun（当前验证版本 1.4.2）。当前通过 `file:../fia/packages/cli` 使用相邻 FIA 源码的构建产物，以接入原生外观切换和系统浏览器登录回调；首次运行需先构建框架（需要 Swift 工具链）。

```sh
cd ../fia
bun install --ignore-scripts
bun run runtime:build
bun run cli:build
cd ../malatang
bun install --ignore-scripts
bun run dev
```

本地 FIA 包由 Bun 安装到依赖目录，不是实时源码链接。修改 FIA 后先重新构建 runtime / CLI，再在麻辣烫运行 `bun install --force --ignore-scripts` 刷新依赖，最后重建应用。

会启动 FIA 桌面应用。在开发实例已运行时，获取一次性浏览器链接：

```sh
bun run agent open --browser --url
```

`bun run build` 生成 `dist/Malatang.app`。开发和打包应用使用各自的 FIA 数据目录，互不覆盖。开发后端读取资源的根目录是项目目录；打包后是随应用分发的 backend 目录。

## 先体验

GitHub 构建、正式签名公证发布与应用自动更新配置见 [发布说明](docs/github-release.md)。普通 CI 生成测试包；推送稳定版标签发布安装包和签名更新。设置中可手动检查更新。

1. 打开侧栏最下方「设置 → 模型服务」。有 ChatGPT 订阅时点击 **Continue with ChatGPT**，在系统浏览器授权，返回后选择账号可用模型并添加；也可选择 Pi 预设填写 API Key，或配置自定义 OpenAI-compatible 服务。
2. 打开「译文」，选择已配置模型，输入文本开始翻译。宿主不提供模拟模型；没有可用模型时提示先配置，不能发起生成。旧演示历史仍可查看并明确标注，不会自动恢复为当前结果。
3. 在「应用中心」安装随手记示例，它由 `bun pm pack` 独立打包，使用公开 SDK 和宿主 KV。
4. 停用、启用或卸载插件；卸载保留 KV 和运行历史。
5. 在「设置 → 外观」或点击图标栏的外观快捷按钮，选择浅色、深色或跟随系统；选择会保存在本机，重启后恢复。插件页面、SDK 组件与原生标题栏同步切换。

## 当前范围

- 图标侧栏、插件页面和统一 UI tokens / React 组件。
- 浅色 / 深色 / 跟随系统主题；应用级偏好持久化，默认跟随系统。
- 配色参考用户提供的 ChatGPT 客户端截图，使用分层中性灰、灰色选中态与黑白主操作；保留 48px 紧凑图标侧栏。
- 插件可声明 `keepAlive: true` 保留切页时的草稿、选项和滚动位置，默认切页卸载；翻译和新版随手记已开启，刷新 / 重启后的恢复仍通过 KV。
- 版本化 manifest、独立构建前端 / 可选后端、动态插件方法及输入 schema。
- 设置面板内按侧边菜单切换模型服务和外观，保留未提交表单。模型列表支持搜索、编辑、删除，预设模型可按名称或 ID 搜索。
- Pi 多服务商预设、宿主模型列表、流式文本生成、取消、最近 30 次运行摘要及完整快照、重连读取；配置变化即时同步到翻译插件。
- 按插件 ID 划分的持久化 KV；原子文件替换和串行写入。
- 页面与 FIA CLI 共用安装接口，接收 npm 包、Git HTTPS 来源及本地 `.tgz`；随手记本地包路径已经实测。

可信本地扩展与宿主同进程执行，不构成安全沙箱。凭证不通过业务 API 返回前端。ChatGPT OAuth 凭证在 macOS Keychain 中保存，开发 / 生产按数据目录分开；其他模型 API Key 沿用权限受限的本机配置文件。

当前已实现 ChatGPT 官方订阅 OAuth；其他服务商订阅登录、云身份认证、工具注册 / 调用、agent loop、调研应用、插件自动升级和签名分发尚未实现。npm/Git 下载路径已实现但尚未用远端真实插件验收；要求预构建、自包含产物，安装不执行生命周期脚本。

## 模型服务

使用固定版本 `@earendil-works/pi-ai@1.0.0` 的 42 个内置 provider 目录与原生协议适配器。40 个预设同时提供文本模型和 API Key / Token 配置；OpenAI Codex 需要尚未接入的订阅登录，TypeSafe 仅提供非聊天模型，这两项会显示说明并禁用保存。目录随依赖升级更新，不自动联网刷新。

- Azure OpenAI 需要资源 API 地址，可指定部署名称和 API 版本。
- Cloudflare Workers AI 需要 Account ID，AI Gateway 还需要 Gateway ID。
- Amazon Bedrock 使用 Bearer Token 和 AWS 区域；Google Vertex 使用 Google Cloud API Key；Copilot 使用 Pi 支持的 Copilot token。本轮不接入 AWS Profile / IAM、ADC / 服务账号或其他服务商订阅登录流程。
- 各模型使用 Pi 的对应协议与默认地址，也可覆盖 API Base URL。旧配置继续按自定义 Chat Completions 服务处理，不改变原地址和密钥。
- 编辑时不返回密钥：留空保留，勾选可清除；更换服务商或 API 地址后需重新填写密钥。同一服务商可以添加多份模型配置。

插件通过统一 SDK 调用，不需识别上游协议。真实账号、额度和模型权限在首次调用时确认。

## ChatGPT 官方订阅登录

接入依据：[官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与调用](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)，核对日期 2026-10-03。

- 点击 Continue with ChatGPT 后在系统浏览器登录并批准订阅权限，回到应用，从实时账号目录选择模型并添加到宿主。插件使用原有模型 SDK；SDK `ModelSelect` 显示 Using ChatGPT plan 和用量入口。
- 每个安装保存稳定 host ID；首次动态注册，后续复用已签发 client ID。PKCE、一次性 state、OIDC nonce 与 JWT 签名 / issuer / audience / 到期时间检查由宿主完成。首次授权失败后仍保留已签发注册供重试。
- 登录错误会标明回调处理、授权码交换、账号验证或凭证保存阶段。点击「重试此账号登录」复用失败注册；重启后保留当前账号，没有当前账号时默认选中最近创建的登录记录，直接点击 Continue 即可重试，也可手动切换其他账号。默认选择登录目标不会激活未经验证的身份，只有「添加账号」或首次登录才创建新注册。
- 多个注册独立保存，即便邮箱相同也不合并。已有模型固定绑定原账号，不因设置中的账号切换而改变。仅登录身份但未授予订阅使用权限时，不允许推理。
- 到期前串行刷新并保存旋转 refresh token；临时网络失败不清除凭证。退出尝试远程撤销并清除本机 token，保留注册。未确认远程撤销时会给出 ChatGPT 设置入口。不要复制其他应用的登录文件，也不要把回调 URL 或 token 发到对话中。
- 展开「管理账号」可重命名、单个移除，或批量「清理未完成登录」。清理只选择从未通过身份验证的记录，确认后原子写入 Keychain；已退出的有效账号不会被批量选中。已连接账号需先退出，绑定模型需先从模型列表移除，登录进行中不能编辑。重命名同步模型列表中的账号显示名称，不改变模型 ID / 计费绑定；移除仅删除本地注册，再次登录需添加账号，不注销 ChatGPT 账号或撤销远程应用授权。
- 回调复用 FIA 的实际 loopback 端口 `/api/oauth/openai/callback`，不启动第二个服务。登录等待 10 分钟，可取消，切页不中断。刷新模型目录不产生生成请求。
- 订阅使用公开 `/v1/responses`，请求为 `store: false`、`stream: true`，只在 `response.completed` 后成功；不会自动切换 API Key 计费。账户可用模型来自 `/v1/models` 的可见条目，不复制 Pi 的 API Key 目录。

真实账号授权与 GPT 调用需本机能连接 `auth.openai.com` 和 `api.openai.com`。`unsupported_country_region_territory` 表示 OpenAI 拒绝当前请求来源地区，不能仅据此判断订阅无效。FIA 后端启动时读取显式代理环境变量，否则跟随 macOS 手动 HTTP / HTTPS 系统代理；变更后重启应用。暂不转换系统 PAC / SOCKS 配置，详见 FIA 框架文档。不要在应用中关闭 TLS 校验或重复创建注册来处理网络错误。2026-10-03 已确认真实订阅授权与账号目录，生产翻译插件使用 GPT-6-Astra 完成一次真实调用。其他模型、真实 token 刷新 / 撤销未逐项验收。首次读取钥匙串可能需要系统确认；FIA 已在等待原生请求时暂停启动计时。

## 插件开发

见 [SDK 文档](packages/sdk/README.md)。完整例子：

- `plugins/translate/`：内置前后端插件，仅经 SDK 调用模型及存储。
- `examples/quick-notes/`：独立前端插件，打包安装后使用 KV。

当前 SDK 为 workspace 包，尚未发布 npm。构建脚本把插件业务依赖打入产物，并通过宿主共享 React 避免重复运行时。

## CLI

复用 FIA 的应用命令，开发中使用 `bun run agent`，无额外服务或 CLI。

```sh
bun run agent call chatgpt.status --json '{}'
bun run agent call models.list --json '{}'
bun run agent call models.providers --json '{}'
bun run agent call models.catalog --json '{"providerId":"anthropic"}'
bun run agent call appearance.get --json '{}'
bun run agent call appearance.set --json '{"theme":"dark"}'
bun run agent call plugins.list --json '{}'
bun run agent call plugins.install --json '{"source":"/absolute/path/plugin.tgz"}'
bun run agent call plugins.jobs --json '{}'
bun run agent call plugins.invoke --json '{"pluginId":"translate","method":"translate","input":{"text":"Hello","target":"简体中文","modelId":"从 models.list 取得的模型 id"}}'
bun run agent call runs.list --json '{"pluginId":"translate"}'
```

安装和生成返回任务 ID，需查询终态。动态业务方法在 `plugins.list.methods` 中提供名称、描述和 JSON Schema。列表中的运行文本截为 300 字符，完整结果使用 `runs.get`。

## 检查

```sh
bun test tests
bun run check
bun run build
```

测试覆盖 ChatGPT 动态注册、JWT 签名 / state / nonce / 过期校验、回调重放、多账号隔离、身份授权与订阅权限区分、旋转刷新、取消、退出撤销及订阅 Responses 参数 / 终态；另覆盖 Pi 目录、OpenAI Responses / Anthropic Messages / DeepSeek 协议、Cloudflare 路由与认证、旧配置迁移、密钥编辑和隐藏、字节分片 SSE、失败与取消、凭证隐藏、KV 并发与重启、主题偏好迁移 / 持久化 / 并发切换、manifest / 路径校验、独立后端加载以及本地归档安装 / 重启 / 卸载。安装测试需要 Bun 能写入临时目录和本机包缓存。

页面生命周期回归：在运行中的 FIA 开发浏览器会话，打开同源 `/tests/keep-alive.html`，应显示全部 PASS。该测试使用真实 React / DOM 验证延迟挂载、草稿、滚动、隐藏焦点、卸载清理、样式启停和同版本资源替换，无额外测试服务器；生产构建不包含此页面。

登录与账号管理 UI 回归：同一开发实例打开 `/tests/chatgpt-login.html`，以隔离的 API fixtures 检查单个 / 多个注册恢复、失败账号重试、手动选择、等待 / 取消、显式添加账号、首次登录、重命名及保存失败、单个 / 批量移除的确认和保护。加 `?preview` 可交互查看测试账号，不发起真实授权或写入 Keychain；生产构建不包含此页面。

翻译模型 UI 回归：同一开发实例打开 `/tests/translate-models.html`，检查空列表与快捷键禁用、旧模型偏好回退、旧演示历史来源、真实模型 ID 的 SDK 调用以及账号断开 / 最后一个模型删除。此页面使用离线 fixtures，不代表真实模型联网验收。
