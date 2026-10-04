# GitHub 构建、正式发布与自动更新

目标仓库：`potato47/malatang`。官网为 [Semicoder · 麻辣烫](https://semicoder.dev/malatang)，用户安装入口固定为 [下载与安装](https://semicoder.dev/malatang/docs/installation)。正式发行的完整 `.dmg` 托管在 GitHub Releases；具体版本和下载以官网安装页及 Release 为准，`fia-runtime-*` 预发布只是框架依赖。

自动更新地址继续固定为 `https://nobug.space/malatang/updates/latest.json`，更新数据不随官网迁移。发布脚本仅将该站点首页跳转至 Semicoder，保留 `updates/` 下的清单和不可变历史文件。应用支持 macOS 14+ / Apple Silicon；正式包安装时打开 DMG，将 `Malatang.app` 拖到 Applications 后启动，无需另外安装 Bun。

2026-10-04 已发布 [v0.1.0 / build 1](https://github.com/potato47/malatang/releases/tag/v0.1.0)，标签指向 `f1b1c7fc60120c9af1c41dd14b1c35b532fc6bc8`。[正式发布工作流](https://github.com/potato47/malatang/actions/runs/37214205671/attempts/2) 已通过签名、公证、镜像运行和更新校验，Release 附件已公开。独立验收确认公网 Pages 清单 HTTP 200、Ed25519 签名与 13 个在线文件的大小 / SHA-256 均正确；匿名下载 DMG 的 SHA-256、`hdiutil verify`、stapler、DMG / 应用 Gatekeeper 及应用 codesign 检查通过，安装包与更新逐文件一致。跨版本客户端升级尚未实测。以下配置步骤用于环境重建；后续发行必须增加版本和 build，不能重建或移动已发布标签。

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
4. 创建 `release` 和 `github-pages` Environments，核对待发布标签及手动验收分支的部署许可。首发时 `github-pages` 原先仅允许 `main`，本次保留其他保护、仅新增精确 `v0.1.0` 标签规则。以后每次发布前检查对应标签的 allowlist，按该次发布授权增加必要规则，不改为允许全部分支或标签。保护发布分支及标签，发布凭据仅供可信源码使用。`gh-pages` 是生成数据分支，不将它合回 `main`。
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

当前 workspace 依赖包含尚未发布到 npm 的 FIA 修复。因此 CI 从本仓库专用 Release 下载已验证的框架归档，校验 `release/runtime-lock.json` 的 SHA-256，并放入相邻 `fia/packages/cli`，继续使用现有冻结锁文件。不是每次编译框架，也不以 Actions cache 充当永久依赖。

本次支持 DMG 的归档为 `artifacts/runtime/dmg/semicoder-fia-0.16.1.tgz`；源码提交、附件名、专用标签及 SHA-256 均在 runtime lock 中。`0.16.1` 是本地包版本，不表示它与 npm 同版本包内容相同。归档已上传至 [fia-runtime-8650f80f4a11](https://github.com/potato47/malatang/releases/tag/fia-runtime-8650f80f4a11)，不要重复创建该标签或覆盖附件。更换框架时，使用新的源码提交、归档和专用标签，以预发布且非 latest 的 Release 保存，并在说明中记录 SHA-256。

上传前核对归档 SHA-256。不要重新打包后覆盖同一附件；即使源码没变，打包 / 编译工具链也可能改变二进制哈希。更新 FIA 时发布新的固定归档和 lock（或迁移到包含修复的固定 npm 版本），再发完整安装包。旧归档保留，确保旧标签可重现。

## 发布版本

`package.json.version` 是版本号，`release/config.json.build` 是严格递增构建号，`fia.config.ts` 引用二者。当前正式版本为 `v0.1.0` / build 1；下一版例如 `0.1.1` / build 2，在应用仓库执行：

```sh
bun run version:app 0.1.1
bun run check
bun test tests
bun run build
# 审阅并提交版本和代码，将版本提交合入 main 后：
git push origin main
git tag -a v0.1.1 -m 'Malatang 0.1.1'
git push origin v0.1.1
```

`version:app` 同时递增 build；推送标签前复核 `release` / `github-pages` 环境允许该精确标签。只支持稳定版 `x.y.z`；预发布不能进入稳定更新源。应用版本不等于 SDK 或插件版本，不自动修改后者。

Release 与更新源发布完成后，核对正式 DMG 附件、SHA-256、签名公证报告及匿名下载，再同步 Semicoder 安装页与 `docs/project-sources.md`。网站主干推送会独立触发部署，不属于应用发布的自动步骤。新 Release notes 包含官网与安装页链接，已公开版本不回写。

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
