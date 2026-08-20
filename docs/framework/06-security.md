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

只有显式使用 `fia dev --print-session-url` 时，runtime 才会把一个同样受 30 秒 TTL 和单次消费
约束的 bootstrap URL 输出到 stderr，供本次开发进程的 E2E 工具使用；生产构建忽略该内部开关。

## 进程与包

- Host 不通过 shell、PATH 或运行时下载启动生产 Backend。
- 生产 helper 路径固定，校验签名后文件的 SHA-256，并 inside-out codesign。
- stdout 只允许协议；runner 在导入项目 entry 前把 `console.*` 重定向到 stderr。
- 配置、菜单、窗口参数和 URL 均做严格形状、长度与 allowlist 校验。

## 原生数据

- 文件面板只返回用户选择的绝对路径；FIA 不扫描目录，也不持久化访问授权。
- Keychain service 固定为 bundle identifier，使用不可同步、仅本机的
  `afterFirstUnlockThisDeviceOnly` 可访问性；Backend 不能指定其他 service 或批量列举条目。
- PNG 剪贴板与截图 API 只通过 FIA 管理且受校验的本地临时文件交换数据，图片字节不进入
  stdio；文本请求和所有 JSON 结果仍受 1 MiB stdio 帧限制。
- 通知权限只能由应用显式申请；`send` 不会隐式触发系统授权提示。
- 屏幕捕获权限只能由应用显式申请；runtime 为每个 Desktop session 在 Backend Application
  Support 中生成隔离的临时 PNG 路径，Host 继续校验目录、扩展名和目标不存在，且默认排除自身
  窗口。显式释放、session 停止和下个 session 首次截图都会清理临时文件。
- 打开、Finder 定位和废纸篓操作只接受存在的绝对路径；FIA 不提供通用文件读写 API，目录遍历
  与业务文件操作仍由 Backend 负责。
- 全局快捷键使用系统热键注册，不安装键盘 event tap，也不请求辅助功能或输入监控权限。
