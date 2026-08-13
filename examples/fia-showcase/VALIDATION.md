# FIA Toolbox 验收清单

## 自动门禁

```bash
bun run --cwd examples/fia-showcase typecheck
bun run --cwd examples/fia-showcase test
bun run --cwd examples/fia-showcase build
```

纯逻辑测试不调用真实 `screencapture`、`mdfind` 或用户 Home。真实 Host 会话另行运行：

```bash
FIA_SHOWCASE_E2E=1 bun run --cwd examples/fia-showcase test:e2e
```

E2E 会启动 macOS `.app`/Host 会话，消费一次性 bootstrap URL，并验证 overview 与 capability API；
权限相关交互仍需人工确认。

## 人工纵向验证

### 启动与生命周期

- 状态栏左键打开透明、无边框搜索窗口；`Option + Space` 行为一致。
- Dock reopen 打开工具箱首页；关闭窗口后 Backend 与状态栏继续运行。
- 修改 Backend/UI 后热重载，事件监听器和当前目录 watcher 不重复注册。

### 截图

- 未授权时截图返回明确提示，不在启动时弹授权框。
- 能力中心授权后，整屏截图取触发瞬间鼠标所在显示器。
- `Control + Shift + 4` 在每个显示器各显示一个遮罩；任选一个拖拽后其余遮罩一起隐藏/关闭。
- 成功后图片出现在历史、图片剪贴板可粘贴、预览窗口为单例；并可打开、访达定位或移到废纸篓。
- 并发触发只允许一个 capture；超过 30 天或总数超过 500 的历史在启动/截图后清理。

### 搜索

- 中文、单字符、多词和含引号查询可用；多词为 AND，字段为 OR，正文内容不参与匹配。
- 连续快速输入时旧查询不会覆盖新结果；输入法组合期间不提交。
- 方向键选择、Enter 打开、Esc 隐藏、失焦隐藏正常。
- 页面看不到绝对路径；打开、定位和复制路径都通过 opaque result token 在 Backend 执行。

### 文件管理

- 可添加多个根目录，切换目录后 watcher 自动刷新，失败时仍可手动刷新。
- API 只接受 `rootId + relativePath`；`..`、绝对路径、符号链接、套接字/设备被拒绝。
- 图片、PDF Range、文本前 1 MiB 预览正常；opaque token 过期后需重新预览。
- 新建目录、大小写重命名、文件/目录复制到任意根内目录、原子复制副本、同卷移动、系统打开/定位、
  复制路径可用。
- 同名冲突不覆盖；跨卷移动被拒绝；根目录不能重命名/移动/删除；删除失败不改变列表状态。

### 能力中心与设置

- 显示屏幕录制、通知、显示器、窗口、快捷键、Dock/状态栏状态。
- 文件面板、通知、文本剪贴板、Keychain roundtrip 均能手动验证。
- 分别验证打开文件、打开目录、保存文件面板，截图图片剪贴板，以及多个窗口的 open/focus/hide。
- WebSocket 断开后自动重连；通过关闭/重开窗口与 Dock reopen 验证 Backend 生命周期和 reopen 事件。
- 快捷键设置仅在 Host 注册成功后写入 SQLite；冲突时保留上次成功设置并显示原因。
- 截图保留天数限制 1–365，条数限制 1–500，并在重启后保持。

## 已发现的框架缺口

- 当前 FIA initialize/app context 未向 Backend 暴露运行时签名类型，因此能力中心将签名状态标为
  `unknown`，不会猜测。发布验收需分别对开发 ad-hoc 构建和 Developer ID 构建执行
  `codesign -dv --verbose=4 <App>`，并记录 TeamIdentifier/Authority；后续建议 FIA 提供只读、Host
  权威的 signing metadata。
