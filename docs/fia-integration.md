# FIA 共仓开发与后续拆分

状态：2026-10-10，已纳入麻辣烫 0.4.1 发布候选，公开验收尚未完成。麻辣烫是 FIA 的第一个正式应用，先通过同仓开发完善框架，产品稳定后再独立拆出。

## 来源与边界

通过不压缩的 Git subtree 导入 `potato47/fia` 的完整祖先历史，来源提交为 `0a319af8619578f3a3c99a34d389886499166d9d`，前一应用提交为 `c766a05db213f673a2e74bb7373aeee8fb3ffde9`。框架位于 `framework/fia/`，没有嵌套 Git 或 submodule。原仓库保留历史，不双向同步；新的框架改动与应用一起提交。

框架保持通用窗口、通信、原生能力、构建和 CLI；麻辣烫保留业务、模型与插件平台。应用通过 `@semicoder/fia/*` 消费 workspace 包，框架不得反向导入业务。共仓迁入时应用源码路径、标识、数据目录和 Keychain 身份保持原状；随后应用凭证改为数据目录内的文件，不再访问或迁移旧 Keychain 登录，见根 README 的未发布凭证说明。

## 开发与构建

在宿主根执行 `bun install --frozen-lockfile --ignore-scripts` 后运行 `bun run dev`。Bun 固定 1.4.3，源码构建需要 Apple Silicon macOS 和 Swift 6 工具链。TypeScript/原生修改自动构建和重启开发实例；依赖清单、锁文件、维护工具变化则提示手工重启。前端 HMR 和业务后端重载沿用既有机制。框架自动重启清除未保存页面状态、撤销浏览器会话，持久数据不移动。

`framework:prepare` 校验并准备产物；`framework:check` 检查框架；`framework:pack` 验证实际归档；`framework:verify` 在仓库外独立安装、构建并消费归档。框架工具及排除监听规则见[维护说明](../framework/fia/docs/co-development.md)。互斥锁防止构建交叠，失败不标记成功产物；缓存须同时满足输入与输出哈希。异常中断后只有确认 owner.json 中进程已停止，才可清理报告旁的锁目录。

`framework/fia/.fia/framework-build/report.json` 记录当前提交及 dirty 状态、框架源码指纹、根锁文件哈希、Bun/Swift/SDK 与 native/CLI 输入输出哈希。当前内部版本字符串继续为 FIA 0.18.0，不等于该版本的公开 npm 归档。CI 从同一提交构建框架再构建应用，并附带报告；旧版本的 runtime lock 仅在历史标签继续使用。

## 拆分保障

共仓只有根锁文件；框架仍保留独立 package 声明、模板、测试和文档。独立导出会安装自己的依赖、生成自己的锁文件，再检查归档以及仓库外的新应用。通用模板不能加入麻辣烫专用规则。共仓期间禁用 FIA npm 发布，应用和 SDK 发布规则独立，既有签名、公证及更新源保持原样。

在用户确认麻辣烫稳定后：

1. 从本仓库执行 `git subtree split --prefix=framework/fia`，将结果导入原 FIA 仓库的新分支，核对其包含原始历史及迁入后的框架修改，不强制覆盖远端。
2. 在独立仓库生成并提交锁文件，运行检查、归档、最小应用及原生验收；重新核对 CI、标签、OIDC 与 Trusted Publisher。
3. 在单独取得发布授权后发布新 FIA 包，验证公开产物，再把麻辣烫 workspace 依赖改为该版本，删除内嵌目录，重复应用及 DMG 验收。
4. 同步官网安装与迁移说明。拆分、推送、发布各自记录实际结果，不自动执行。

可在一次性 checkout 内放置 `.fia/integration-fixture` 后运行 `bun framework/fia/tools/smoke-integration.ts .` 验证自动重建；该测试会临时编辑源码，结束恢复，禁止在日常工作目录运行。
