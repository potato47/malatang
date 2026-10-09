# GitHub 构建、正式发布与自动更新

目标仓库：`potato47/malatang`。官网为 [Semicoder · 麻辣烫](https://semicoder.dev/malatang)，用户安装入口固定为 [下载与安装](https://semicoder.dev/malatang/docs/installation)。正式发行的完整 `.dmg` 托管在 GitHub Releases；具体版本和下载以官网安装页及 Release 为准，`fia-runtime-*` 预发布只是框架依赖。

自动更新地址继续固定为 `https://nobug.space/malatang/updates/latest.json`，更新数据不随官网迁移。发布脚本仅将该站点首页跳转至 Semicoder，保留 `updates/` 下的清单和不可变历史文件。应用支持 macOS 14+ / Apple Silicon；正式包安装时打开 DMG，将 `Malatang.app` 拖到 Applications 后启动，无需另外安装 Bun。

2026-10-09 已发布 **[v0.4.0 / build 4](https://github.com/potato47/malatang/releases/tag/v0.4.0)**，源码标签 `620d19a450578ca98c58c3ae1b7e13b524e57368`。[主干 CI 37888908778](https://github.com/potato47/malatang/actions/runs/37888908778) 与 [正式发布 37888912203](https://github.com/potato47/malatang/actions/runs/37888912203) 成功，实际消费 FIA 官方 v0.18.0 归档；本机 check / 69 测试 / build 与原生 Dev / Preview 置顶、取消置顶通过。SDK 保持 0.2.1。`github-pages` 仅增加精确 v0.4.0 tag 规则，其余保护未改动。

五项公开附件匿名下载与 digest 核对通过。DMG 为 30,513,939 字节，SHA-256 `8aca60752d1e25a28e50dbd122b03b505ed40088408d73bab0ab7077617ffef7`；独立 hdiutil / stapler / Gatekeeper DMG 与 app / codesign、安装包与签名更新逐文件比对通过。公网清单与 Release 一致，Ed25519 签名和 33 个在线文件大小 / SHA-256 通过。runtimeId `9cd13e79576bff74bb3ca30f659e0cd1e40a9d407b3b0102dd9f2895ee63dbf4`。

公开 DMG 在临时独立数据目录启动，CLI 确认 0.4.0 / build 4 / FIA 0.18.0 / ready，原生 UI 实际点击置顶与取消置顶反馈通过。未操作用户正式账号或调用模型；旧版需要完整 DMG 升级，账号、模型、KV 和历史保留。跨版本代码热更新未实测。Semicoder 安装入口、介绍与置顶指南同步，官网部署单独记录。

2026-10-09 此前已发布 [v0.3.0 / build 3](https://github.com/potato47/malatang/releases/tag/v0.3.0)，标签固定于 `7c0f237986728d13063fd25e38e0a826738af213`。[主干 CI](https://github.com/potato47/malatang/actions/runs/37868718881) 与 [正式发布工作流](https://github.com/potato47/malatang/actions/runs/37868966391) 全部成功。

五项附件经匿名下载与 GitHub digest 核对；`Malatang-0.3.0-3-mac-arm64.dmg` 为 30,516,155 字节，SHA-256 `8784f623d3a97fbf2f7acc7f2e00fa098154f939209aca5503b33d35fc589145`。独立 hdiutil / stapler / Gatekeeper / codesign 与只读挂载应用、签名更新逐文件比对通过；公网清单 Ed25519 签名与全部 33 个在线文件的大小 / SHA-256 通过。runtimeId 为 `2f469910b09105865dc6df75930f16b39c8fa707ebddc31ef8a35844a259f22d`。

正式 DMG 另在本机临时独立数据目录启动，原生首屏 ready、标题栏入口、CLI 浏览器授权、Chromium 动态插件页面及原生文件面板打开通过；退出时面板请求取消、浏览器显示统一失效提示。文件最终选取与超过 30 秒等待、Safari 和模型流的实测证据来自此前本地同实现验收，本次没有再次操作真实模型或用户数据。

0.3.0 原生 Host 已改变，从 0.2.0 或更早版本升级需完整 DMG；账号、配置、KV 和历史保留，SDK 0.2 插件继续兼容。SDK 0.2.1 已独立发布 npm，见 [SDK 发布说明](npm-release.md)。跨版本代码热更新仍未实测；官网由独立 Semicoder 主干工作流同步。

以下为 0.2.0 历史发行证据，新版本不覆盖旧标签或附件：

2026-10-05 已发布 [v0.2.0 / build 2](https://github.com/potato47/malatang/releases/tag/v0.2.0)，标签固定于 `c82d6adebf0f1dfe81ded21ce15ef4b7c15040be`。[正式发布工作流](https://github.com/potato47/malatang/actions/runs/37289643139) 全部成功，五项附件已匿名下载验证。DMG SHA-256 为 `5d8171ab67748b5203f1abf8a3af9938edf474acf12e4441a3370899d34c03b5`；镜像完整性、公证、Gatekeeper、应用签名及安装包与更新逐文件一致性通过。公网清单 Ed25519 签名与 33 个在线文件的 size / SHA-256 校验通过。

0.2.0 使用新的 FIA runtime ID，0.1.0 用户需完整 DMG 升级；旧 SDK 插件需迁移重建，账号、模型配置、KV 和历史保留。SDK 0.2.0 已独立发布 npm，具体方式与 OIDC 验收边界见 [SDK 发布说明](npm-release.md)。跨版本代码更新仍未实测。以下配置步骤用于环境重建；后续发行必须增加版本和 build，不能重建或移动已发布标签。

## 工作流

- `Build Malatang`：`main` 提交、PR 或手动触发。执行 check、测试、`build --dmg`（含挂载镜像、签名完整性和应用启动退出检查），上传测试 DMG、校验文件和报告。应用仅 ad-hoc 签名、关闭更新，DMG 不签名公证；不使用发布密钥。
- `Release Malatang`：`v*` 标签触发正式发布。手动运行也会签名、公证并上传验收产物，但不发布 Release 或 Pages。
- `Publish Malatang SDK`：独立 `sdk-v*` 标签通过 OIDC 发布 `@semicoder/malatang-sdk`；手动运行只验收归档。普通 CI 同时验证 SDK 的 npm 打包和独立插件构建。首次 npm 账号 / Trusted Publisher 配置见 [SDK 发布说明](npm-release.md)。
- 正式流程：版本校验 → 固定 FIA 包 → 测试 → 临时钥匙串 → Developer ID Application 签名应用与 DMG → 对 DMG 公证 / staple / Gatekeeper 验证 → 挂载后验证应用签名、Gatekeeper 和启动退出 → 签名代码更新 → 安装包与更新逐文件比对 → GitHub Release → 保存更新历史到 `gh-pages` → Pages 部署。
- 发布按仓库串行运行。已公开 Release 的附件不覆盖；同一 build 的更新内容不可改写；旧标签重跑不得倒退更新源。Pages 部署失败可以重跑发布 job，沿用已发布内容。

## 首次配置

从未配置 Apple 签名时，先按 [Apple 签名与公证逐步操作](apple-signing-setup.md) 准备证书、公证密码及 GitHub 环境。

1. 创建仓库并推送源码。公开仓库可使用免费 GitHub Pages；私有仓库需要支持 Pages 的计划，更新文件仍需能被未登录客户端访问。更新产物包含业务代码，不应包含任何用户数据或凭证。
2. 上传下述固定 FIA 包，之后再运行 CI。
3. Settings → Pages → Source 选择 **GitHub Actions**。项目继承账号已有 `nobug.space` 域名，不另设项目自定义域名。`potato47.github.io` 会重定向到该域名，而 FIA 更新下载拒绝跨域重定向，因此必须直接使用实际 HTTPS 地址；改变域名 / 路径需要更换应用内固定地址并重新发安装包。
4. 创建 `release` 和 `github-pages` Environments，核对待发布标签及手动验收分支的部署许可。首发时 `github-pages` 原先仅允许 `main`，本次保留其他保护、仅新增精确 `v0.1.0` 标签规则。0.2.0 发布经用户明确许可追加精确 `v0.2.0` 规则，其余保护不变。以后每次发布前检查对应标签的 allowlist，按该次发布授权增加必要规则，不改为允许全部分支或标签。保护发布分支及标签，发布凭据仅供可信源码使用。`gh-pages` 是生成数据分支，不将它合回 `main`。
5. 在 `release` 环境中配置以下 Secrets，内容不要提交到 Git：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | 含私钥的 **Developer ID Application** `.p12` 文件的 Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| `APPLE_ID` | Apple Developer 登录邮箱 |
| `APPLE_TEAM_ID` | Apple 团队 ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | 用于 `notarytool` 的 Apple 专用密码 |
| `FIA_UPDATE_PRIVATE_KEY` | Ed25519 更新私钥的完整 PEM 文本 |

6. 在 `release` 环境 Variables 设置 `APPLE_SIGNING_IDENTITY`，值为完整身份，如 `Developer ID Application: Your Name (TEAMID)`。此名称参与运行时兼容判断；变更时需要完整安装包。
7. 先手动运行 `Release Malatang`，确认签名、公证、smoke 和产物校验全部通过，再发布首个标签。

首次生成的更新私钥保存在本机 `.fia/release-secrets/update-private.pem`（权限 0600）；公钥已写入 `release/config.json`。备份私钥并上传 Secret，不能每次发布重新生成。更换公钥需重新安装可信安装包。可用已登录的 GitHub CLI 安全上传，不在终端输出密钥：

```sh
gh secret set FIA_UPDATE_PRIVATE_KEY --repo potato47/malatang --env release < .fia/release-secrets/update-private.pem
base64 < /path/to/DeveloperID.p12 | gh secret set APPLE_CERTIFICATE_P12 --repo potato47/malatang --env release
gh secret set APPLE_CERTIFICATE_PASSWORD --repo potato47/malatang --env release
gh secret set APPLE_ID --repo potato47/malatang --env release
gh secret set APPLE_TEAM_ID --repo potato47/malatang --env release
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo potato47/malatang --env release
gh variable set APPLE_SIGNING_IDENTITY --repo potato47/malatang --env release --body 'Developer ID Application: Your Name (TEAMID)'
```

GitHub runner 使用临时钥匙串，最后恢复默认钥匙串并删除私钥 / 证书。构建任务仅有仓库读取权限；发布任务才有 Release 与 Pages 写入权限。私钥与签名凭据不进入 artifact。

## 固定 FIA 包

0.4.0 / build 4 使用 FIA 官方 [v0.18.0](https://github.com/potato47/fia/releases/tag/v0.18.0)，归档来自正式 GitHub Actions 的同一 npm artifact，SHA-256 `faf196b9408cc2fa4b9edfb0145c592a9a87b6fbc0b0245ad6b89c6c0e7ff4e2`，源码 `85206f6f532242fb2dfcfdf2a4b608f131726bf5`。无需复制为麻辣烫的新框架预发布；旧 `fia-runtime-*` 保留供历史版本重现。官方 npm 公开消费与应用正式发行结果分别验收。

CI 从 `release/runtime-lock.json` 指定的公开 Release 下载已验证的 FIA 框架归档，校验 `release/runtime-lock.json` 的 SHA-256，并放入相邻 `fia/packages/cli`，继续使用现有冻结锁文件。不是每次编译框架，也不以 Actions cache 充当永久依赖。

0.2.0 所用归档来自 FIA dd430c851192，包含应用子命令和启动等待修复；源码提交、附件名、专用标签及 SHA-256 均在 runtime lock 中。`0.16.1` 是本地包版本，不表示它与 npm 同版本包内容相同。归档已上传至 [fia-runtime-dd430c851192](https://github.com/potato47/malatang/releases/tag/fia-runtime-dd430c851192)，不要重复创建该标签或覆盖附件。这是旧版本的归档保存方式；后续优先锁定 FIA 官方 Release 的已验证归档，记录对应源码与 SHA-256，不重打包或覆盖旧附件。

上传前核对归档 SHA-256。不要重新打包后覆盖同一附件；即使源码没变，打包 / 编译工具链也可能改变二进制哈希。更新 FIA 时发布新的固定归档和 lock（或迁移到包含修复的固定 npm 版本），再发完整安装包。旧归档保留，确保旧标签可重现。

## 发布版本

`package.json.version` 是版本号，`release/config.json.build` 是严格递增构建号，`fia.config.ts` 引用二者。当前已发布版本为 `v0.4.0` / build 4；下一版本准备示例，在应用仓库执行：

```sh
bun run version:app 0.4.1
bun run check
bun test tests
bun run build
# 审阅并提交版本和代码，将版本提交合入 main 后：
git push origin main
git tag -a v0.4.1 -m 'Malatang 0.4.1'
git push origin v0.4.1
```

`version:app` 同时递增 build；推送标签前复核 `release` / `github-pages` 环境允许该精确标签。只支持稳定版 `x.y.z`；预发布不能进入稳定更新源。`release/notes/<version>.md` 会追加到对应正式 Release 说明，用于记录用户可见变化和迁移步骤。应用版本不等于 SDK 或插件版本，不自动修改后者。

Release 与更新源发布完成后，核对正式 DMG 附件、SHA-256、签名公证报告及匿名下载，必须在同一发布任务同步 Semicoder 安装页、项目介绍、受影响使用指南/迁移说明与 `docs/project-sources.md`，并记录官网内容及部署状态。网站主干推送会独立触发部署，按当次授权执行；受阻时明确记录未完成项与完成条件，不能仅以应用已发布宣称整次交付完成。新 Release notes 包含官网与安装页链接，已公开版本不回写。

新安装包与签名更新的 `downloadURL` 指向官网安装页。发布校验只允许该地址及旧版 `https://github.com/potato47/malatang/releases/latest`，以便读取不可改写的历史签名清单；不得因此放宽更新文件的固定来源、签名或内容校验。改官网入口不改 `updatesURL`、历史清单或已有 Release 附件。

FIA 的 `runtimeId` 包含 `updates.downloadURL`，因此此次入口修改会改变新安装包的 runtime ID。已有旧入口验收包应完整安装正式 DMG；未来更高 build 的更新发现 runtime ID 不同也会要求完整安装，不能只用代码更新替换该配置。历史清单可读不表示旧安装包与新运行时兼容。

自动更新会在启动时 / 每 24 小时检查并下载；用户确认后生效。设置 → 应用更新可手动操作。模型、插件或登录任务进行时 `beforeUpdate` 阻止切换；安装会重新加载页面，未保存草稿不会跨更新恢复。启动 / 观察失败回退代码，业务数据不回滚，持久化格式更改必须兼容旧代码。独立安装插件不随宿主自动升级。

原生宿主、Bun、权限、图标、更新密钥或签名身份等改变 runtime ID 时，旧客户端提示下载完整安装包，不静默替换 `.app`。初次安装的老版本未包含更新地址，需要手动安装本次新包一次。

## 保留历史与恢复

`gh-pages/updates/releases/<build>/` 是不可变目录，每次部署携带全部历史，避免客户端取到旧清单后下载 404。不要手工删改。接近 Pages 1 GB 限制时脚本在 900 MB 拒绝发布，需要先规划迁移更新源。安装包仅放 Releases，不进入 Pages。

- 构建、公证或签名失败：没有发布 job；修复配置后重跑。
- Release 已公开但 Pages 失败：重跑失败 job；不覆盖已公开安装包。相同清单可重试。
- 重跑完整 workflow 得到与已发布版本不同的代码文件：拒绝覆盖，升版本 / build 后再发布。
- 已发版本业务出错：提交修复并提高版本 / build，不通过覆盖 `latest.json` 或旧标签强制远程降级。
- 本地可用 `bun scripts/release/verify.ts dist/updates dist/Malatang.app` 验证更新签名、每个文件及安装包一致性；首发公网清单与文件已独立验收，跨版本客户端升级尚未实测，网站部署另行核实。

依据：[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[GitHub macOS 签名证书](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[FIA 构建与代码更新](../node_modules/@semicoder/fia/docs/framework/README.md)。

## 0.3.0 浏览器界面与运行时

0.3.0 / build 3 接入 FIA 0.17.0 默认浏览器入口、独立会话与原生权限白名单，以及文件对话框连接与等待修复。`release/runtime-lock.json` 已切换到公开 [fia-runtime-4689c707913c](https://github.com/potato47/malatang/releases/tag/fia-runtime-4689c707913c)，源码提交 `4689c707913ca31f93b03cfe4deb61466c9e69f2`，归档 SHA-256 `521a07c387efa5b2c7ddbb76807b5c613b5b26cdf6e9c84fb965d27a5dd536b6`；已匿名下载并与验收包逐字节核对。旧归档保留。

本次发布授权下，`github-pages` 仅新增精确 `v0.3.0` 标签许可，其他保护保持不变。Host 标题栏与菜单变化需要完整 DMG，从 0.2.0 或更早版本升级不能只安装代码更新。SDK 为 0.2.1，manifest 兼容版本仍为 0.2；SDK 与应用发行分别验收。浏览器文件选择在白名单内，不开放钥匙串、屏幕捕获或其他被拒绝的 Native 能力。
