# FIA Toolbox

FIA Toolbox 是 FIA 仓库中的综合示例与 dogfood 应用。它使用一个常驻 Bun Backend、多个原生
WebView 和标准 HTTP/WebSocket，覆盖截图、Spotlight 文件搜索、受根目录约束的文件管理与原生
能力诊断。

## 运行

从仓库根目录安装 workspace 依赖后：

```bash
bun run --cwd examples/fia-showcase dev
bun run --cwd examples/fia-showcase typecheck
bun run --cwd examples/fia-showcase test
bun run --cwd examples/fia-showcase build
```

配置 `fia.config.ts` 的 `release.identity` 后，可运行 `package` 生成预公证 ZIP；再配置
`release.notarization.keychainProfile` 后，可运行 `release` 生成已公证的最终 ZIP。

默认快捷键：

- `Option + Space`：显示文件搜索窗口。
- `Control + Shift + 4`：在所有显示器上显示区域截图遮罩。

快捷键与截图保留策略可在“能力中心”修改。应用启动不会主动申请权限；第一次截图前需由用户在
能力中心申请屏幕录制权限。macOS 可能要求授权后重新启动应用。

## 功能边界

- 截图：指针所在屏幕整屏截图、多显示器区域遮罩、SQLite 历史、图片剪贴板、轻量单例预览、
  打开/定位/另存副本/废纸篓，以及 30 天与最多 500 条自动清理。
- 搜索：`mdfind` 的文件名、显示名、类型、作者与 Finder 标签元数据查询；不搜索正文，不调用 shell。
- 文件：用户通过原生目录面板添加多个根目录；浏览器只接触 `rootId + relativePath`，预览内容使用
  短期 opaque token；支持文件/目录根内复制、同卷移动、原子 no-replace 提交，符号链接与特殊文件不能
  预览或修改；最近访问位置存入 SQLite 并在删除根目录时级联清理。
- 能力中心：权限、显示器、多窗口、WebSocket、全局快捷键、通知、打开/目录/保存面板、文本/图片
  剪贴板和 Keychain 的状态与手动验证。

绝对文件路径只保存在 Backend/SQLite 中，永不通过 JSON DTO 暴露给网页。删除操作统一调用 macOS
废纸篓，不直接永久删除用户文件。

详细人工验收见 [VALIDATION.md](./VALIDATION.md)。
