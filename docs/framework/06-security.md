# 安全模型

## 1. 威胁边界

需要防御：

- 同一台机器上的其他进程访问 localhost API
- 恶意网页或 DNS rebinding 请求本地服务
- UI 中的远程 Markdown/HTML 获取 native bridge
- 不受信任输入触发高权限 native bridge 命令
- 密钥写入前端 bundle、URL 或日志
- 应用包签名后被修改

## 2. localhost 服务

要求：

- 只绑定 `127.0.0.1`，不绑定 `0.0.0.0`。
- 使用 `port: 0` 取得随机端口，不由 Host 预选端口。
- 每次启动生成至少 256-bit 随机 session token。
- 使用一次性 bootstrap token 建立会话，随后废弃该 token。
- Bun 设置 `HttpOnly`、`SameSite=Strict` 的随机会话 cookie。
- HTTP API 和 WebSocket 都验证当前会话。
- 校验 `Host` 和 `Origin`。
- 对 WebSocket 连接做协议版本握手。
- 限制请求体大小、连接数和空闲时间。
- 生产模式不返回内部堆栈。

bootstrap token 和独立 control token 通过 Host 独占的 stdin 生命周期管道在 initialize
消息中传给 Bun。Host 使用一次性 bootstrap URL 完成首个页面请求；Bun 设置 cookie 后
立即重定向到干净 URL。token 不得进入环境变量、命令行、日志、持久化设置或错误报告。

`/__fia/health` 只接受 Host 持有的 Bearer control token。bootstrap token 成功兑换后立即
废弃，不能用于健康检查或其他 API。

## 3. WKWebView

- 只允许主 frame 导航到当前 `127.0.0.1:<port>` origin。
- 外部链接使用系统浏览器打开。
- 默认关闭 Web Inspector，开发模式显式开启。
- 使用独立 website data store。
- 配置严格 CSP。
- 禁止不受信任页面使用同一个 privileged WebView。

远程内容需要经过 Markdown/HTML sanitizer。原始 HTML 默认关闭。

## 4. Native bridge

- 命令使用 allowlist，不允许动态 selector。
- 每个命令验证参数 schema。
- 只接受当前 `127.0.0.1:<runtime-port>` 精确 origin 的主 frame；同源子 frame 也被拒绝。
- bridge protocol 1 请求固定为 `{version, command, params}`，单条 JSON 消息不超过 64 KiB。
- WebView 或 Runtime 重建时注销旧 handler，避免旧页面继续持有原生入口。
- 错误只返回稳定错误码与脱敏消息，不返回 Swift 类型、堆栈或任意 selector。
- 文件面板返回 security-scoped 或明确授权路径。
- Keychain API 只接受框架生成的 service namespace。
- 高风险命令需要用户可见确认。

当前切片只开放应用退出、Dock/状态栏显示、窗口显示/聚焦和三个独立窗口标志。文件面板、
通知、外部打开和 Keychain 尚未开放，因此对应权限策略在实现这些命令时再单独验收。

## 5. Bun 应用边界

FIA 不向应用提供内置的文件、外部进程、源码管理或领域工具 capability 层。Bun 应用代码
选择的依赖和系统访问由应用自身负责授权、校验和审计，不构成 FIA 公共 API。

框架只保证 Host、localhost 服务、WebView 和 native bridge 之间的通信边界。业务接口仍需
由应用验证输入和权限，远程内容必须与受信任的应用 origin 隔离。

## 6. 签名与运行数据

- `.app` 内所有 executable 和 framework 先内层后外层签名。
- 阶段 1 本地构建使用 ad-hoc 签名；阶段 3 的 Developer ID 发布构建必须启用 hardened runtime。
- 应用运行时不得修改 bundle 内文件。
- 更新通过替换整个签名应用完成。
- 数据、日志和下载内容只写入系统允许目录。

## 7. 日志脱敏

默认过滤：

- session token
- API key 和 Authorization header
- Keychain value
- URL query 中的凭据
- 用户主目录的可识别部分（诊断包可选）

诊断包创建前展示包含的文件和脱敏结果。
