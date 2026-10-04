# 首次配置 Apple 签名与公证

这是 `potato47/malatang` 的首次发布操作手册。代码和 GitHub Actions 已准备好；正式包必须等下列凭据配置完成才能发布。不要把证书密码、Apple 专用密码或更新私钥粘贴到聊天、Issue 或仓库文件里。

## 1. 确认 Apple Developer 资格

打开 [Apple Developer 账户](https://developer.apple.com/account/)，确认已加入 Apple Developer Program，并可访问 Certificates, Identifiers & Profiles。只有普通 Apple Account 尚不能创建所需的 Developer ID。个人开发者通常就是 Account Holder；组织账号需由 Account Holder 创建本地 Developer ID 证书。[Apple 说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)

在账户 Membership details 中记下 **Team ID**。它不是邮箱，也不是 App Store 中应用的数字 ID。

## 2. 在这台 Mac 生成证书请求

1. 用 Spotlight 打开 **钥匙串访问 / Keychain Access**（不是“密码”应用）。
2. 菜单选择 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**。
3. 用户电子邮件地址填 Apple Developer 邮箱，常用名称填自己的姓名或团队名称，CA 电子邮件地址留空。
4. 选择 **存储到磁盘**，保存 `.certSigningRequest` 文件。这个过程同时把配对私钥留在本机钥匙串中。

操作依据：[Apple CSR 步骤](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)。后面的证书下载后要安装到生成这个 CSR 的同一台 Mac。

## 3. 创建 Developer ID Application 证书

1. 打开 [Certificates](https://developer.apple.com/account/resources/certificates/list)，点击 **＋**。
2. 在 Software 区域选择 **Developer ID Application**。麻辣烫分发的是包含 `.app` 的 **`.dmg` 磁盘映像**，应用和 DMG 都使用这类证书签名；不需要 Developer ID Installer（后者用于 `.pkg`）。[Apple 打包说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
3. 若页面要求选择中间证书，按 Apple 当前页面为现代 Xcode 推荐的选项继续。
4. 上传刚才的 `.certSigningRequest`，继续并下载 `.cer`。
5. 双击 `.cer` 安装到钥匙串。进入“登录”钥匙串 → **我的证书**，找到 `Developer ID Application: 姓名或团队 (TEAMID)`。
6. 展开左侧箭头，应看到其下的私钥。如果没有私钥，通常是 CSR 来自另一台 Mac；必须回到生成 CSR 的钥匙串导出，单独的 `.cer` 不足以供 CI 签名。

## 4. 导出含私钥的 .p12

1. 在“我的证书”选中完整的 Developer ID Application 条目。
2. 右键 → **导出**，格式选择 **个人信息交换 (.p12)**，保存为例如 `DeveloperID-Malatang.p12`。
3. 设置一个非空的导出密码，存入自己的密码管理器。系统可能再次要求本机登录密码批准导出。
4. 在终端运行：

   ```sh
   security find-identity -v -p codesigning
   ```

5. 复制引号中的完整身份，例如 `Developer ID Application: Your Name (ABCDE12345)`，稍后填到 `APPLE_SIGNING_IDENTITY`。不要复制前面的哈希或引号。

导出流程也见 [GitHub macOS 签名说明](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)。

## 5. 创建公证专用密码

1. 打开 [Apple Account](https://account.apple.com/)，使用所属开发团队的 Apple Account 登录。账户需要双重认证。
2. 打开 **登录和安全 → App 专用密码 / App-Specific Passwords**。
3. 生成一个新密码，名称可用 `Malatang GitHub Notarization`。
4. 保存生成的专用密码，稍后填到 `APPLE_APP_SPECIFIC_PASSWORD`。这里使用专用密码，不是 Apple Account 的主密码。

修改 Apple Account 主密码会使已有专用密码失效，届时重新生成并更新 Secret。[Apple 专用密码说明](https://support.apple.com/102654)

## 6. 在 GitHub 的 release 环境填写凭据

打开 [仓库 Environments](https://github.com/potato47/malatang/settings/environments)，进入名为 **release** 的环境。没有时点击 **New environment** 创建。

Environment secrets 中点 **Add environment secret**，逐项添加：

| Name | Value 从哪里来 |
| --- | --- |
| `APPLE_CERTIFICATE_P12` | 第 4 步 `.p12` 的 Base64 文本，下面命令可复制 |
| `APPLE_CERTIFICATE_PASSWORD` | 第 4 步设置的 `.p12` 导出密码 |
| `APPLE_ID` | 用于公证的开发者 Apple Account 邮箱 |
| `APPLE_TEAM_ID` | 第 1 步的 Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | 第 5 步生成的专用密码 |
| `FIA_UPDATE_PRIVATE_KEY` | 已生成的 Ed25519 更新私钥 PEM；与 Apple 证书是两种独立密钥 |

复制 `.p12` 的 Base64 到剪贴板（替换路径），然后直接粘贴到对应 Secret，不要粘贴到源码：

```sh
base64 < '/完整路径/DeveloperID-Malatang.p12' | pbcopy
```

更新私钥已经生成在本机以下位置。只有在 GitHub 尚未配置该 Secret 时才上传这份；不要重新生成另一份：

```sh
pbcopy < '/Users/next/projects/fia-workspace/malatang/.fia/release-secrets/update-private.pem'
```

接着在同一环境的 **Environment variables** 添加：

| Name | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | 第 4 步获得的完整 `Developer ID Application: … (TEAMID)` |

Secrets 保存后不会显示原值，这是正常现象。配置完告诉协作 agent“Apple 配置完成”即可继续验收，无需提供密码。

## 7. 开启 Pages 并验收

1. 打开 [Pages 设置](https://github.com/potato47/malatang/settings/pages)，在 Build and deployment 的 Source 选择 **GitHub Actions**。保留默认 `potato47.github.io/malatang` 地址。
2. 发布 workflow 必须已合入 GitHub 默认分支，才会出现手动入口。打开 **Actions → Release Malatang → Run workflow**，选择待验收分支。
3. 这次手动运行会完成构建、签名、公证、应用启动退出检查和更新签名，但**不会公开新版本或部署更新源**。
4. 全部通过后，在运行详情底部下载 `malatang-release` artifact（GitHub 会将 artifact 包成 ZIP），解压后取得 `Malatang-版本-构建号-mac-arm64.dmg`。最终用户直接从 Releases 下载该 DMG。
5. 双击 DMG，将 `Malatang.app` 拖到窗口中的 **Applications / 应用程序**，完成后推出磁盘映像，从“应用程序”启动麻辣烫，检查“设置 → 应用更新”。首次正式标签发布前更新源还没有清单，检查失败是预期；完成下一步后再验证。
6. 按 [发布说明](github-release.md) 推送 `v0.1.0` 标签（首次）或更高版本标签。等待 Release 和 Pages 发布成功。
7. 完整更新验收需保留上一版，再发布较高 build：旧版检查 → 下载 → 确认 → 页面重新加载 → 版本号提升。无需真实模型请求。失败回退另用隔离测试包验证，不要故意向公开稳定源发布坏包。

## 常见问题

- 找不到 Developer ID Application：核对会员是否有效、是否使用 Account Holder、是否选择了正确团队。
- `.p12` 不可选或 CI 提示无有效身份：证书缺少配对私钥；单独下载 `.cer` 不能修复，需要原 CSR 的私钥。
- `Prepare signing credentials` 失败：逐项核对 Secret 名称、`.p12` 密码、Team ID、专用密码，以及公私钥是否配对。凭据不要输出到 CI 日志。
- 公证失败：下载并查看该次 `notarytool` 的公证日志；不能跳过公证继续发布。
- Pages 403：确认 Source 是 GitHub Actions，`github-pages` 环境允许版本标签，workflow 具备 pages / id-token 权限。
- 尚未配置 Apple 凭据：可以先运行普通 `Build Malatang` 验证测试包；它不会冒充正式签名包，也不会进入更新源。
