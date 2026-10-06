# SDK npm 自动发布

仓库 `potato47/malatang`；发布包 `@semicoder/malatang-sdk`，源码在 `packages/sdk`。SDK 以 TypeScript / TSX 源码供 Bun 插件工具链使用，包含 types、client、runtime、manifest、UI、主题/组件 CSS、构建/检查工具与 notes/model 模板，不依赖 FIA 源码或应用目录。

## 包名与版本

| 包 | 用途 | 分发方式 |
| --- | --- | --- |
| `@semicoder/malatang-sdk` | 插件 SDK | `sdk-v<x.y.z>` 标签触发 npm 发布 |
| `@semicoder/malatang-plugin-translate` | 内置翻译 | 保持 `private: true`，随应用分发 |
| `@semicoder/malatang-example-quick-notes` | 随手记示例 | 构建为本地 `.tgz`，随应用分发；本流程不发布它 |

SDK 0.2.0 是随麻辣烫 0.2.0 提供的破坏性更新：manifest `sdkVersion` 为 `"0.2"`，要求 CSS Modules 和宿主共享 UI。SDK 0.1 插件须迁移并重新构建，不能直接安装或启用；原 ID、宿主标识及 KV 命名空间不变，用户数据保留。历史包名迁移与此次兼容版本升级是两次不同变更。

SDK 版本独立于应用版本，当前源码 SDK 和应用版本均为 0.2.0；应用发行不代表 SDK 已发布 npm。应用 `v*` 标签继续发布 DMG / 更新源；SDK `sdk-v*` 标签只发布 SDK，不执行 Apple 签名、公证或部署 Pages。当前只支持稳定 `x.y.z`，不支持预发布和 build metadata。

## 当前发布状态

2026-10-05，`@semicoder/malatang-sdk@0.2.0` 已通过维护者 npm 登录首次正式发布。发布的是 `npm:pack` 验证后的归档；registry latest 为 0.2.0，公开 tarball 与本地逐字节一致，SHA-1 为 `32d14881d97c71ffcef14cd3358305d6b7209bb5`。在 workspace 外通过 registry 安装后，模板 check/build/pack 全部通过。应用标签 `v0.2.0` 固定源码提交 `c82d6adebf0f1dfe81ded21ce15ef4b7c15040be`。

此次使用本机 npm 认证，未执行远端 OIDC 发布验收；Trusted Publisher 设置仍需后续核对。不再推送 `sdk-v0.2.0` 触发重复发布；未来独立标签必须使用新版本。下面首次配置步骤用于重建发布流程，不应重复发布已有版本。

## 首次配置

1. 将本次源码和 `.github/workflows/publish-npm.yml` 合入 GitHub 默认分支。工作流名为 **Publish Malatang SDK**，手动运行始终只验收并上传 `.tgz`，不会发布。
2. 创建 GitHub `npm` Environment；若限制可部署标签，允许 `sdk-v*`。
3. SDK 尚未发布时，先用有 `@semicoder` 发布权限的 npm 账号完成首次发布。执行下面的本地验收，再发布已经验证的归档；当前版本示例：

   ```sh
   npm login
   npm publish ./artifacts/npm/semicoder-malatang-sdk-0.2.0.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org
   ```

   首次发布是实际公开操作，只有准备发布时才执行；不能用 empty placeholder 代替 SDK。已发布版本不能覆盖，也不要再推送相同版本标签尝试重复发布。
4. 在 npm 包 Settings → Trusted publishing 添加 GitHub Actions 发布者：

   | 字段 | 值 |
   | --- | --- |
   | Organization or user | `potato47` |
   | Repository | `malatang` |
   | Workflow filename | `publish-npm.yml` |
   | Environment name | `npm` |
   | Allowed actions | 允许直接 `npm publish` |

工作流采用 OIDC，使用 Node 24、npm 11.19.0、Bun 1.4.2。只有 publish job 申请 `id-token: write`，不配置 `NPM_TOKEN` / `NODE_AUTH_TOKEN`。仅目标仓库的 SDK 标签可以进入发布 job；手动验收不需要 npm 认证。公开包、公开仓库经 OIDC 发布时 npm 自动生成 provenance。依据：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 本地验收

先准备应用依赖（沿用应用的本地 FIA 或固定归档流程），在麻辣烫根目录执行：

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun test tests
bun run npm:check
bun run npm:pack
```

`npm:pack` 使用 `npm pack --ignore-scripts` 生成 `artifacts/npm/semicoder-malatang-sdk-<version>.tgz`，检查包名、版本、仓库、发布目标、入口与文件范围，再在临时目录安装该归档和精确同版本的 React / ReactDOM。临时消费者验证 runtime schema、SDK 导入、主题文件，并以包内构建器编译翻译与随手记，确认共享宿主 React / JSX / ReactDOM / UI 和完整 JS / CSS / 资源产物。临时目录最终清理；消费验收需要联网下载公开依赖。

普通 `Build Malatang` CI 也执行 SDK 验收。发布工作流在 macOS 完成相同检查、打包和测试，检查未改动受跟踪文件，再上传唯一版本归档；Linux publish job 下载同一归档并发布，不重新构建。

## 官网文档同步

每次 SDK 发布必须同步独立 Semicoder 仓库 `content/projects/malatang/` 的插件开发指南、项目介绍、兼容/迁移说明和相关安装内容；在网站 `docs/project-sources.md` 记录源码提交、实际 npm 版本、归档与独立消费结果。应用 Release 与 SDK npm 分别验收，未发布 API 不替代默认教程。workspace 内网站入口为 `../semicoder/`。

官网内容及部署状态纳入当次发布交付。缺少产物证据或部署授权时记录未完成项与完成条件；网站 `main` 推送会部署，不因 SDK 已发布而自动获得推送授权。

## 后续发布

以下为下一 SDK 版本的操作示例：

```sh
bun run version:sdk 0.2.1
git diff -- packages/sdk/package.json bun.lock
# 检查、提交并合入 main 后，在该提交创建标签：
git tag -a sdk-v0.2.1 -m "Malatang SDK 0.2.1"
git push origin sdk-v0.2.1
```

`version:sdk` 更新 SDK 的 package.json 和 Bun 锁文件，拒绝同版本、降级及非法版本，不改变应用、插件或 manifest 兼容版本，不自动提交或创建标签。跨兼容版本时仍需单独调整宿主的 SDK 兼容契约。

GitHub Actions → **Publish Malatang SDK** → **Run workflow** 可提前验收。实际 OIDC 权限只能由真正发布验证；本地测试、dry-run 和 `npm whoami` 不能证明它已可用。认证失败时核对 npm 发布者五个字段、仓库元数据与 Environment；版本已存在时检查 registry，使用下一版本，不覆盖旧包。
