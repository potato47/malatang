# 安全边界

## loopback 会话

- Bun 强制绑定 `127.0.0.1`，不接受监听地址配置。
- Host 生命周期生成高熵会话密钥，仅通过子进程 stdin 发送。
- 打开本机应用页面时 runtime 生成 30 秒单次 bootstrap code。
- bootstrap 设置 HttpOnly、SameSite=Strict、Path=/ cookie 后重定向到无凭证 URL。
- protected routes、fetch fallback 和 WebSocket upgrade 校验 cookie、精确 Host 与 Origin。
- `/_fia/*` 保留；`publicRoutes` 只用于应用明确公开的 HTML/静态资源。

因此页面可以使用普通 `fetch`/WebSocket，JavaScript 无需读取密钥。外部网页即使在 WebView
中加载，也得不到应用 cookie 或任何原生桥。

## 进程与包

- Host 不通过 shell、PATH 或运行时下载启动生产 Backend。
- 生产 helper 路径固定，校验签名后文件的 SHA-256，并 inside-out codesign。
- stdout 只允许协议；runner 在导入项目 entry 前把 `console.*` 重定向到 stderr。
- 配置、菜单、窗口参数和 URL 均做严格形状、长度与 allowlist 校验。
