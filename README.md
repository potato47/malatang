# 麻辣烫 · Malatang

基于 FIA 的本地插件应用平台。宿主提供模型、存储和统一界面组件，独立插件组合这些能力，拥有自己的应用页面。

## 0.4 版本

0.4.0 / build 4 接入 FIA 0.18.0，原生标题栏在浏览器入口左侧增加置顶图标。点击切换当前窗口置顶，隐藏再显示和后端重连保留，退出后重置。默认由 FIA 提供，应用无需重复实现。原生运行时变化需完整 DMG 升级；SDK 保持 0.2.1 / manifest 0.2。

## 0.2 版本（历史）

0.2.0 使用 **SDK 0.2.0 / manifest 0.2** 的统一 UI 与 `malatang plugin create/check/build/pack`。需要新的 FIA 应用子命令 runtime；旧归档和 v0.1.0 不包含这些能力。升级请完整安装新 DMG，旧插件迁移后重新构建，模型、账号、KV 和历史保留。固定 runtime 以 `release/runtime-lock.json` 为准；下载状态以官网和 Release 为准。

## 下载与安装

官网统一位于 [Semicoder · 麻辣烫](https://semicoder.dev/malatang)，[下载与安装](https://semicoder.dev/malatang/docs/installation) 页面提供正式 DMG 下载、发行状态与安装指引。具体版本和校验信息以该页及 [GitHub Releases](https://github.com/potato47/malatang/releases) 为准；`fia-runtime-*` 预发布仅供构建，不是麻辣烫安装包。

应用支持 macOS 14+ / Apple Silicon，安装后的应用自带运行时，无需另装 Bun。官网安装页的已发布 v0.4.0 源码使用固定 FIA 归档，无需编译 Swift；本开发分支的工具链要求见下文。

## 开发运行

当前开发分支把 FIA 完整源码及历史放在 `framework/fia/`，与麻辣烫共用根 workspace 和锁文件。麻辣烫是 FIA 的第一个正式应用；待产品稳定后再独立拆出框架。本次重构尚未发布，版本字符串仍为应用 0.4.0 / FIA 0.18.0，不能据此视为已发布产物相同。

源码开发需要 Apple Silicon macOS、Bun 1.4.2 和 Swift 6 工具链（可通过 Xcode / Command Line Tools 提供）。在本仓库根目录执行：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
```

首次启动自动构建 FIA 原生运行时和 CLI；以后按源码、工具链及产物哈希复用。FIA 的 TypeScript 或 Swift/C 源码修改会自动停止当前 Dev 实例、重建并启动；构建失败时保持停止，修复后自动恢复。麻辣烫前端继续 HMR，后端沿用受控重载。重启会清除未保存页面状态并使浏览器授权失效，持久数据保留。依赖清单、锁文件或联调工具自身变化时，终端提示重新安装依赖或重启 dev，不自动安装依赖。

`bun run run`、`build`、`check`、`release` 自动准备同一份框架。框架专用命令：

```sh
bun run framework:prepare  # 校验或构建原生运行时与 CLI
bun run framework:check    # 框架 lint / format / TypeScript / CLI / Swift
bun run framework:pack     # 构建并验证实际 FIA 归档，不发布
bun run framework:verify   # 导出到仓库外，独立安装、检查、打包和应用消费
```

不再需要相邻 FIA checkout、force install 或先发布 FIA。框架构建使用互斥锁，冲突会报错；进程正常退出会清理锁，异常中断后须确认原进程已退出才清理提示的锁目录。构建来源、工具链和哈希报告位于 `framework/fia/.fia/framework-build/report.json`。详见[框架迁入与拆分](docs/fia-integration.md)。

会启动 FIA 桌面应用。从 0.3.0 开始，默认通过标题栏最右侧“在浏览器中打开”进入完整界面；开发、预览和正式构建均由 FIA 提供入口，无需第二个服务或插件 SDK 改动。

```sh
bun run agent open --browser
bun run agent --preview open --browser
# 自动化需要链接时显式使用 --url（60 秒、一次有效）
bun run agent --preview open --browser --url
```

浏览器与原生窗口共享模型、插件、KV、主题和持久数据，不复制未保存草稿。刷新保留当前标签页授权，后端重启 / 更新后需重新从标题栏进入；应用菜单和托盘菜单的“断开浏览器连接”立即撤销全部浏览器会话。授权失效显示 FIA 提示并停止重连。普通 IP + 端口无法直接调用受保护 API。

浏览器可使用文件选择、剪贴板、窗口操作和更新界面；框架禁止直接调用钥匙串、CLI 管理、退出、屏幕捕获等高权限 Native 方法。模型凭证仍由后端管理，业务 API 和可信插件边界不变。

**升级要求：** 0.3.0 使用 FIA 0.17.0 的新原生运行时；从 0.2.0 或更早版本升级须下载完整 DMG，不能仅安装代码更新。账号、模型配置、KV 和运行历史保留。

使用当前 workspace FIA 构建包时，`bun run dev` 显示 `Malatang Dev` /「麻辣烫 · 开发版」，Dock 带黄色 `DEV` 标记，菜单栏也显示 `DEV`；macOS Bundle ID 为 `com.semicoder.malatang.dev`。现有 `.fia/dev/data/com.semicoder.malatang` 数据与按路径区分的 Keychain 登录项继续使用，无需搬迁。

`bun run run` 构建并启动 `.fia/preview/Malatang Preview.app`，显示「麻辣烫 · 预览版」、蓝色 `PREV` 标记，使用独立的 `.fia/preview/data/com.semicoder.malatang` 数据。直接打开该预览包也保持隔离，数据跨重启保留；首次使用需单独配置模型。`bun run agent --preview` 控制预览版，例如 `bun run agent --preview quit`。开发版与预览版都禁用正式更新源，可与官网版同时运行。显式安装的本地 CLI/skill 分别为 `malatang-dev`、`malatang-preview`，正式入口仍为 `malatang`。

`bun run build` 仍生成正式身份的 `dist/Malatang.app`，默认与已安装官网版共用正式数据目录，同目录只允许一个实例。日常测试使用上述 dev / run；不要用正式构建路径判断数据已隔离。开发后端资源根目录是项目目录；预览/正式打包后是随应用分发的 backend 目录。

以上开发标记和隔离 run 从 0.3.0 / FIA 0.17.0 开始提供；旧 0.2.0 固定快照中的 `run` 仍访问正式数据。已发布 v0.4.0 及更早源码仍需使用相应标签的 `release/runtime-lock.json`；本开发分支改为从同一提交构建框架。

## 先体验

GitHub 构建、正式签名公证发布与应用自动更新配置见 [发布说明](docs/github-release.md)。普通 CI 生成测试包；稳定版发布流程生成正式安装包和签名更新，完成公开发布后由官网安装页提供下载入口。设置中可手动检查更新。

1. 打开侧栏最下方「设置 → 模型服务」。有 ChatGPT 订阅时点击 **Continue with ChatGPT**，在系统浏览器授权，返回后选择账号可用模型并添加；也可选择 Pi 预设填写 API Key，或配置自定义 OpenAI-compatible 服务。
2. 打开「译文」，选择已配置模型，输入文本开始翻译。宿主不提供模拟模型；没有可用模型时提示先配置，不能发起生成。旧演示历史仍可查看并明确标注，不会自动恢复为当前结果。
3. 在「应用中心」安装随手记示例，它由 SDK `packPlugin` 独立打包，使用公开 SDK 和宿主 KV。
4. 停用、启用或卸载插件；卸载保留 KV 和运行历史。
5. 在「设置 → 外观」或点击图标栏的外观快捷按钮，选择浅色、深色或跟随系统；选择会保存在本机，重启后恢复。插件页面、SDK 组件与原生标题栏同步切换。

## 当前范围

- 图标侧栏、插件页面和统一 UI tokens / React 组件。
- 浅色 / 深色 / 跟随系统主题；应用级偏好持久化，默认跟随系统。
- 配色参考用户提供的 ChatGPT 客户端截图，使用分层中性灰、灰色选中态与黑白主操作；保留 48px 紧凑图标侧栏。
- 插件可声明 `keepAlive: true` 保留切页时的草稿、选项和滚动位置，默认切页卸载；翻译和新版随手记已开启，刷新 / 重启后的恢复仍通过 KV。
- 版本化 manifest、独立构建前端 / 可选后端、动态插件方法及输入 schema。
- 设置面板内按侧边菜单切换模型服务、外观和应用更新，保留未提交表单。模型列表支持搜索、编辑、删除，预设模型可按名称或 ID 搜索。
- Pi 多服务商预设、宿主模型列表、流式文本生成、取消、最近 30 次运行摘要及完整快照、重连读取；配置变化即时同步到翻译插件。
- 按插件 ID 划分的持久化 KV；原子文件替换和串行写入。
- 页面与 FIA CLI 共用安装接口，接收 npm 包、Git HTTPS 来源及本地 `.tgz`；随手记本地包路径已经实测。

可信本地扩展与宿主同进程执行，不构成安全沙箱。凭证不通过业务 API 返回前端。ChatGPT OAuth 凭证在 macOS Keychain 中保存，开发 / 生产按数据目录分开；其他模型 API Key 沿用权限受限的本机配置文件。

当前已实现 ChatGPT 官方订阅 OAuth；其他服务商订阅登录、云身份认证、工具注册 / 调用、agent loop、调研应用、插件自动升级和签名分发尚未实现。npm/Git 下载路径已实现但尚未用远端真实插件验收；要求预构建、自包含产物，安装不执行生命周期脚本。

## 模型服务

使用固定版本 `@earendil-works/pi-ai@1.0.2` 的 42 个内置 provider 目录与原生协议适配器。40 个预设同时提供文本模型和 API Key / Token 配置；OpenAI Codex 需要尚未接入的订阅登录，TypeSafe 仅提供非聊天模型，这两项会显示说明并禁用保存。目录随依赖升级更新，不自动联网刷新。

升级会迁移已知的模型 ID 更名，保留宿主模型 ID、凭证、路由、插件偏好与历史。没有明确替代项的失效模型仍保留在列表，但标为不可用并阻止生成；需在设置重新选择当前目录中的模型，不自动替换服务商。

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

SDK 包名为 `@semicoder/malatang-sdk`，仓库内通过 workspace 使用；0.2.0 已于 2026-10-05 首次发布 npm，并通过独立安装验收。首次发布使用维护者 npm 登录，后续 OIDC 尚待验收。[SDK npm 发布流程](docs/npm-release.md) 使用独立的 `sdk-v*` 标签；应用 `v*` 标签继续发布 DMG 和更新源。构建脚本把插件业务依赖打入产物，并通过宿主共享 React 避免重复运行时。

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

## 创建独立插件（开发版）

```sh
bun run agent plugin create /tmp/my-notes --template notes
cd /tmp/my-notes
bun install --ignore-scripts
bun run check
bun run build
bun run pack
```

开发宿主需先 `bun run dev`。安装开发应用的 CLI 后，同样使用 `malatang plugin …`；另有 `--template model`，所有子命令支持 `--help`/`--json`。项目随附 SDK 快照，可离开 workspace 使用。完整契约见 [插件开发](docs/plugin-development.md) 和 [SDK](packages/sdk/README.md)。
