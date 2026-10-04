# GitHub 构建、正式发布与自动更新

目标仓库：`potato47/malatang`。更新地址固定为 `https://potato47.github.io/malatang/updates/latest.json`；完整 `.dmg` 安装包在 GitHub Releases。支持 macOS 14+ / Apple Silicon。用户打开 DMG，将 `Malatang.app` 拖到 Applications 后启动。

## 工作流

- `Build Malatang`：`main` 提交、PR 或手动触发。执行 check、测试、`build --dmg`（含挂载镜像、签名完整性和应用启动退出检查），上传测试 DMG、校验文件和报告。应用仅 ad-hoc 签名、关闭更新，DMG 不签名公证；不使用发布密钥。
- `Release Malatang`：`v*` 标签触发正式发布。手动运行也会签名、公证并上传验收产物，但不发布 Release 或 Pages。
- 正式流程：版本校验 → 固定 FIA 包 → 测试 → 临时钥匙串 → Developer ID Application 签名应用与 DMG → 对 DMG 公证 / staple / Gatekeeper 验证 → 挂载后验证应用签名、Gatekeeper 和启动退出 → 签名代码更新 → 安装包与更新逐文件比对 → GitHub Release → 保存更新历史到 `gh-pages` → Pages 部署。
- 发布按仓库串行运行。已公开 Release 的附件不覆盖；同一 build 的更新内容不可改写；旧标签重跑不得倒退更新源。Pages 部署失败可以重跑发布 job，沿用已发布内容。

## 首次配置

从未配置 Apple 签名时，先按 [Apple 签名与公证逐步操作](apple-signing-setup.md) 准备证书、公证密码及 GitHub 环境。

1. 创建仓库并推送源码。公开仓库可使用免费 GitHub Pages；私有仓库需要支持 Pages 的计划，更新文件仍需能被未登录客户端访问。更新产物包含业务代码，不应包含任何用户数据或凭证。
2. 上传下述固定 FIA 包，之后再运行 CI。
3. Settings → Pages → Source 选择 **GitHub Actions**。不设置自定义域名；改变域名 / 路径需要更换应用内固定地址并重新发安装包。
4. 创建 `release` 和 `github-pages` Environments。发布代码的 `v*` 标签必须被允许；手动验收所用分支也需允许。保护发布分支及标签，发布凭据仅供可信源码使用。`gh-pages` 是生成数据分支，不将它合回 `main`。
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

本次支持 DMG 的归档为 `artifacts/runtime/dmg/semicoder-fia-0.16.1.tgz`；源码提交、附件名、专用标签及 SHA-256 均在 runtime lock 中。`0.16.1` 是本地包版本，不表示它与 npm 同版本包内容相同。归档已上传；更换框架时使用新标签，首次上传命令如下：

```sh
gh release create fia-runtime-8650f80f4a11 artifacts/runtime/dmg/semicoder-fia-0.16.1.tgz \
  --repo potato47/malatang --target main --prerelease --latest=false \
  --title 'FIA runtime 8650f80f4a11' \
  --notes 'Pinned FIA package for Malatang CI. SHA-256 and source commit are recorded in release/runtime-lock.json. Do not replace this asset.'
```

上传前核对归档 SHA-256。不要重新打包后覆盖同一附件；即使源码没变，打包 / 编译工具链也可能改变二进制哈希。更新 FIA 时发布新的固定归档和 lock（或迁移到包含修复的固定 npm 版本），再发完整安装包。旧归档保留，确保旧标签可重现。

## 发布版本

`package.json.version` 是版本号，`release/config.json.build` 是严格递增构建号，`fia.config.ts` 引用二者。首次可发布当前 `v0.1.0` / build 1；后续在应用仓库执行：

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

只支持稳定版 `x.y.z`；预发布不能进入稳定更新源。应用版本不等于 SDK 或插件版本，不自动修改后者。

自动更新会在启动时 / 每 24 小时检查并下载；用户确认后生效。设置 → 应用更新可手动操作。模型、插件或登录任务进行时 `beforeUpdate` 阻止切换；安装会重新加载页面，未保存草稿不会跨更新恢复。启动 / 观察失败回退代码，业务数据不回滚，持久化格式更改必须兼容旧代码。独立安装插件不随宿主自动升级。

原生宿主、Bun、权限、图标、更新密钥或签名身份等改变 runtime ID 时，旧客户端提示下载完整安装包，不静默替换 `.app`。初次安装的老版本未包含更新地址，需要手动安装本次新包一次。

## 保留历史与恢复

`gh-pages/updates/releases/<build>/` 是不可变目录，每次部署携带全部历史，避免客户端取到旧清单后下载 404。不要手工删改。接近 Pages 1 GB 限制时脚本在 900 MB 拒绝发布，需要先规划迁移更新源。安装包仅放 Releases，不进入 Pages。

- 构建、公证或签名失败：没有发布 job；修复配置后重跑。
- Release 已公开但 Pages 失败：重跑失败 job；不覆盖已公开安装包。相同清单可重试。
- 重跑完整 workflow 得到与已发布版本不同的代码文件：拒绝覆盖，升版本 / build 后再发布。
- 已发版本业务出错：提交修复并提高版本 / build，不通过覆盖 `latest.json` 或旧标签强制远程降级。
- 本地可用 `bun scripts/release/verify.ts dist/updates dist/Malatang.app` 验证更新签名、每个文件及安装包一致性；真实云端部署、Apple 凭据和网络更新仍须首次上线验收。

依据：[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[GitHub macOS 签名证书](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)、[FIA 构建与代码更新](../node_modules/@semicoder/fia/docs/framework/README.md)。
