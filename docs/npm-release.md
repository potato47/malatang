# npm 自动发布

GitHub 仓库：`potato47/fia`。npm 包：`@semicoder/fia`，源码在 `packages/cli`。

## 0.17.0 发布记录（2026-10-09）

`@semicoder/fia@0.17.0` 已通过维护者 npm 认证发布，registry latest 为 0.17.0；公开归档与本地验收包逐字节一致，SHA-256 `521a07c387efa5b2c7ddbb76807b5c613b5b26cdf6e9c84fb965d27a5dd536b6`。源码和本地 `v0.17.0` 标签为 `4689c707913ca31f93b03cfe4deb61466c9e69f2`。同一归档保存于麻辣烫 [fia-runtime-4689c707913c](https://github.com/potato47/malatang/releases/tag/fia-runtime-4689c707913c)，匿名下载一致，不重打包。

本次完成 runtime 构建、完整 check / smoke、归档结构与独立默认模板检查 / 构建；新增默认浏览器界面、短期会话、Native 权限白名单、文件对话框连接修复与 Dev / Preview 隔离，也包含此前固定归档的 DMG 和应用子命令能力。原生宿主变化需完整应用安装包升级。

FIA 本地仓库仍无 remote，配置目标 GitHub 仓库返回 404；本次未创建远端仓库、未执行 GitHub OIDC，不能将本机 npm 发布视为远端自动发布验收。不要再推送 v0.17.0 触发重复发布。后续工作流配置说明保留如下；官网由独立 Semicoder 发布流程同步。

## 首次配置

1. 将包含 `.github/workflows/publish-npm.yml` 的代码提交并推送到 GitHub 主分支。手动运行入口需要工作流先存在于默认分支。
2. 在 GitHub 仓库 Settings → Environments 创建 `npm` 环境。若设置部署分支 / 标签限制，需要允许 `v*` 标签。是否添加人工审批由维护者决定。
3. 打开 npm 的 `@semicoder/fia` 包 Settings → Trusted publishing，添加 GitHub Actions 发布者：

   | 字段                 | 值                     |
   | -------------------- | ---------------------- |
   | Organization or user | `potato47`             |
   | Repository           | `fia`                  |
   | Workflow filename    | `publish-npm.yml`      |
   | Environment name     | `npm`                  |
   | Allowed actions      | 允许直接 `npm publish` |

   文件名只填 `publish-npm.yml`，不带目录，大小写必须一致。若包尚不存在，先由维护者在本机认证并完成首次发布，再添加 Trusted Publisher。

工作流使用 GitHub OIDC，不需要 `NPM_TOKEN` / `NODE_AUTH_TOKEN` secret。发布 job 才拥有 `id-token: write`；构建 job 只有源码读取权限。包的 `repository.url` 必须与此 GitHub 仓库一致，fork 不会自动执行发布 job。若迁移仓库，需要同时更新包元数据、版本校验脚本、workflow 仓库限制和 npm 发布者配置。

依据：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。公开仓库使用此认证方式发布时 npm 自动附带 provenance；私有仓库不生成 provenance。

## 发布新版本

在 FIA 仓库内执行，以 `0.17.1` 为例；目标版本必须大于当前版本且尚未发布到 npm：

```bash
bun install --frozen-lockfile
bun run version:npm 0.17.1
git diff
git add package.json packages/cli/package.json packages/cli/src/metadata.ts Sources/FIACore/FIAVersion.swift bun.lock
git commit -m "chore: release 0.17.1"
git push origin main
git tag -a v0.17.1 -m "Release 0.17.1"
git push origin v0.17.1
```

以上示例假定版本提交已在 `main`；使用特性分支时，先将版本提交合入主分支，再在该提交打标签。仓库尚未配置 remote 时，先配置 `origin` 为 `https://github.com/potato47/fia.git`。也可不指定版本执行 `bun run version:npm`，默认递增 minor 并归零 patch。

`version:npm` 只同步根包、CLI 包、TypeScript、Swift 和 `bun.lock` 的版本；不构建、不发布、不提交、不创建标签。不要只执行 `npm version`，否则这几个版本会不一致。

推送 `v*` 标签后，GitHub Actions 会：

1. 校验标签精确等于 `v<package.version>`，且五处版本一致。
2. 在 `macos-26` Apple Silicon runner 使用固定 Bun `1.4.2`、Node `24` 和 Swift 工具链构建 Host 与 Bun 运行时。runner 架构再次检查为 `arm64`；macOS 最低运行版本仍由 `Package.swift` 声明为 14。
3. 使用冻结锁文件安装依赖，执行 `runtime:build` 和完整 `check`（lint、格式、TypeScript、CLI 测试、Swift 测试）。
4. 执行 `npm pack`，解包并验证 CLI 版本、SDK 入口、类型、文档、模板资源、二进制架构 / 校验和 / 可执行权限。构建不能改动受 Git 跟踪的文件。
5. 将验证后的 `.tgz` 保存为 Actions artifact，保留 14 天；独立 Linux job 下载同一归档，以 npm `11.19.0` 和 OIDC 发布，不再构建或执行包生命周期脚本。

正式版本（如 `0.17.1`）发布到 `latest`；含预发布标识的版本（如 `0.17.0-beta.1`）发布到 `next`，不会覆盖 `latest`。使用 `npm install @semicoder/fia@next` 安装预发布版。暂不支持 SemVer build metadata（`+...`），与现有版本工具一致。

GitHub Actions 内不执行本地的 `bun run release`：该命令会递增版本，而 CI 发布的是标签提交中已经确定的版本。本地交互式发布命令仍可使用；同一版本不能本地发布后再通过标签重复发布。

## 官网文档同步

每次版本发布必须同步独立 Semicoder 仓库的 `content/projects/fia/`：介绍、安装、API/CLI、平台与分发指南，并在网站 `docs/project-sources.md` 记录版本证据。先准备相关文档，registry 归档及独立消费通过后再更新默认安装说明；本地同版本构建、固定运行时归档和公开 npm 分开记录。workspace 内网站入口为 `../semicoder/`，不构成框架构建依赖。

网站内容、推送和部署分别验收；`main` 推送会部署，按当次用户授权执行。若官网同步受阻，明确记录未完成项和完成条件，不能仅以 npm 发布成功宣称全部交付完成。

## 不发布的验收

在 GitHub Actions → Publish npm → Run workflow 选择分支或标签。手动运行会完成构建、检查、打包并上传 artifact，**始终跳过发布**，不需要配置 npm 认证。首次配置后先用此入口验证 runner 上的完整构建。

本机也可在固定 Bun 版本下执行：

```bash
bun tools/check-npm-release.ts
bun run runtime:build
bun run check
mkdir -p .temp/npm/unpacked
npm pack --workspace=@semicoder/fia --pack-destination .temp/npm
# 将 <version> 换成 packages/cli/package.json 中的版本。
tar -xzf .temp/npm/semicoder-fia-<version>.tgz -C .temp/npm/unpacked
bun tools/check-npm-package.ts .temp/npm/unpacked/package
```

这不触发实际发布；本地构建与打包通过也不能证明 GitHub OIDC 或 npm 账号配置已经可用。

## 失败处理

- 标签 / 源码版本不一致：用 `version:npm` 同步版本并提交后再打标签；不要在 CI 中临时改版本。
- Bun 版本不一致：一起更新 `BUNDLED_BUN_VERSION` 和 workflow 的 `bun-version`，并重新验收原生运行时。
- 认证失败：检查 npm 发布者的仓库、workflow 文件名、`npm` 环境名、直接发布权限和包的 `repository.url`；必须使用 GitHub 托管 runner。`npm whoami` 不能验证 OIDC 发布权限。
- 同版本已发布：npm 版本不可覆盖；先查询 registry 确认结果。若 publish 已成功但 job 后续失败，不要重复发布，后续修复使用更高版本。
- 构建失败：发布 job 不会执行。修复后使用新提交和版本标签；未发布且源码未变的临时网络失败可重跑同一次 workflow。

Action 使用经核对的提交 SHA 固定版本。升级 Action / npm / runner 时重新检查官方兼容要求。[GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)与 [macOS 26 镜像](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md)列出了 runner 架构和 Xcode 工具链。
