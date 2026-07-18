# 实施路线图

## 阶段 0：风险原型

目标：验证技术闭环，不追求公共 API 稳定。

- Swift Host 创建 `NSWindow` 和 `WKWebView`
- Host 启动 Bun runtime
- Bun 随机端口与 ready handshake
- WebView 加载 Bun 页面
- stdin 生命周期管道
- HTTP health 与 WebSocket echo
- 手工组装和 ad-hoc 签名 `.app`

退出标准：Finder 双击可启动；关闭应用后无残留 Bun 进程。

阶段 0 只提供仓库内部 `prototype:*` 构建与验证脚本，不实现公共
`fia create/dev/run/build`、HMR、状态栏或 native bridge。实验配置和协议不承诺兼容。

## 阶段 1：CLI MVP

- `fia create`
- `fia dev`
- `fia run`
- `fia build`
- `fia doctor`
- 配置 schema
- 预编译 arm64 Host
- Bun full-stack executable
- HMR
- 基础日志聚合

退出标准：一个新项目无需 Xcode 工程完成创建、调试和 `.app` 构建。

## 阶段 2：原生桌面能力

- Dock / status bar / hybrid
- 状态栏菜单与图标状态
- 关闭即隐藏
- always-on-top
- Spaces/full-screen 行为
- 文件和目录选择器
- 通知、外部链接和 Keychain
- native bridge schema 与 origin 校验

退出标准：支持普通窗口、状态栏常驻和系统服务调用的完整桌面交互。

## 阶段 3：发布链路

- Developer ID 签名
- hardened runtime entitlement 验证
- ZIP/DMG
- `notarytool` 公证与 staple
- Gatekeeper 验证
- build manifest
- CI 构建示例

退出标准：产物可在另一台干净 Mac 上正常安装和启动。

## 阶段 4：扩展性和稳定性

- SwiftPM native plugin SDK
- 多窗口
- Universal Binary
- watchdog 严格模式
- 自动更新协议
- 全局快捷键与登录启动
- CLI/Host/project migration

## 优先级原则

1. 先验证进程、WebView 和签名风险。
2. 再设计公共 API，避免为不可行链路过早抽象。
3. 原生 bridge 默认最小化。
4. 安全边界和生命周期正确性优先于能力数量。
5. 每个阶段都必须生成可运行 `.app`，不长期停留在库层。

## 阶段 1 完成后的首个 CLI 里程碑

首个里程碑只实现以下垂直切片：

```text
fia create hello
cd hello
fia dev
fia build
open dist/Hello.app
```

Hello 应用包含一个 WebView 页面、一个 Bun `/api/hello` 接口和一个 WebSocket 流；
退出后用自动化检查确认无残留 runtime。状态栏图标属于阶段 2，不作为 CLI MVP 的前置条件。
