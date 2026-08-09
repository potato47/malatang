# 架构决策

## ADR-001：Swift 是最小状态栏宿主

Host 只拥有 macOS UI 原语和 Backend 生命周期，不实现业务路由、不托管固定页面，也不向
JavaScript 注入能力。

## ADR-002：唯一常驻 Bun Backend

每个 App 只有一个启动即常驻的 Backend。扩展、数据库或 MCP 属于 Backend 内部，不扩大
Host 的进程模型与 ABI。

## ADR-003：网页边界是标准 HTTP/WS

网页与 Backend 的 contract 完全由应用定义。FIA 不发布浏览器 client、RPC facade 或隐藏
transport，因此前端框架和 Backend 业务实现可独立演进。

## ADR-004：Host 能力使用版本化 JSONL stdio

stdio 容易监管、打包且不开放额外端口。协议严格限制版本、帧大小、并发和错误代码；stdout
保留协议，stderr 保留日志。

## ADR-005：本机 HTTP 仍需会话

随机端口和 CORS 不能防止本机进程、DNS rebinding 或跨站写入。FIA 使用 Host 生命周期密钥、
单次 bootstrap、HttpOnly SameSite cookie、Host/Origin 校验，同时让网页保持普通协议。

## ADR-006：状态栏菜单与页面由 Backend 决定

Host 提供完整原生菜单和按 ID WebView 原语。左键事件回传 Backend、右键展示 Backend 菜单；
Backend 决定打开哪个本机或外部 URL，Host 只保留 Quit/Retry 安全入口。

## ADR-007：不兼容旧架构

config 4、Host schema 7 和 stdio 2 精确匹配。静态 UI、MCP bridge、Native MCP、外部 Server、
UI-only 配置及其导出全部删除，不提供 shim 或迁移模式。
