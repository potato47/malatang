# 阶段 2 桌面外壳验收基线

> 记录日期：2026-07-19  
> 状态：首个垂直切片已实现并通过自动化与 macOS GUI 验收

本文记录阶段 2 首个垂直切片的验收结果。范围是 Dock/状态栏/混合桌面模式、窗口行为与
状态恢复，以及 protocol 1 的安全 Native Bridge。文件面板、通知、外部打开和 Keychain
仍属于阶段 2 后续切片；本轮没有执行 npm 发布。

## 验收环境

| 项目 | 已验证值 |
| --- | --- |
| macOS | 26.5.2（Build 25F84） |
| CPU | Apple Silicon，arm64 |
| Bun | 1.3.14（0d9b296a） |
| Swift | 6.3.2 |
| 最低部署目标 | macOS 14.0 |
| 公共配置 | `configVersion: 2` |
| Host 配置 | schema 3；兼容内部 schema 1/2 |
| Runtime / Bridge protocol | 1 / 1 |

## 自动化证据

| 验证 | 结果 |
| --- | --- |
| `bun run typecheck` | 通过 |
| `bun run test:cli` | 52 项通过，覆盖 config v2、Native API、模板、版本流程和三种模式构建 fixture |
| `bun run test:runtime` | 11 项通过 |
| `bun run test:host` | 27 项通过、7 个 suite，覆盖 Core 与 AppKit |
| `bun run check` | 完整通过 |
| `bun run host:package` | release Host 重建完成，manifest checksum 与 arm64 架构通过 |
| `bun run prototype:build && bun run prototype:verify` | legacy schema 1 应用构建、签名与校验通过 |
| `bun run prototype:lifecycle` | 优雅退出、Host 异常、Runtime 异常三种场景均通过且无残留 |

Swift Core 覆盖内部 schema 3 与 legacy 1/2、严格 Bridge 解码、64 KiB 限制、精确
origin/main-frame 授权、桌面状态转换、恢复入口不变量，以及损坏或未知 settings schema
恢复。AppKit 覆盖关闭隐藏、三个窗口标志独立映射、frame 屏幕约束、状态栏菜单状态和
Host 到 WebView 的状态事件 payload。

CLI 构建测试分别生成 `dock`、`statusBar`、`hybrid` fixture，并校验 schema 3、Host
manifest、签名、架构、重复构建和原子替换。生产 UI 另有回归测试，保证 CSP nonce 只注入
真实 HTML 标签，不会改写 JavaScript 字符串中的 `<script` 或 `<style` 文本。

## macOS GUI 证据

- `dock`、`statusBar` 和 `hybrid` 三种配置均实际启动；React 示例通过 Bridge 报告对应的
  有效桌面状态。运行时按钮实际切换过置顶和状态栏可见性。
- `closeBehavior: "hide"` 关闭主窗口后 Host 与 Runtime 保持运行；再次启动同一应用路径后
  主窗口恢复，随后 Command-Q 完成优雅关闭且无残留进程。
- 人为终止已核对 PID 的临时 Runtime 后，Host 显示诊断与 `Restart Runtime` / `Quit`
  操作；选择重启后获得新 PID、通过认证健康检查，并恢复 React 页面和 Native Bridge。
- 生产 `.app` 实际打开后完整渲染 React 示例，Bridge 报告
  `hybrid mode · secure native bridge ready`；Command-Q 后应用与 Runtime 均退出。
- 状态栏左键切换、右键默认菜单及菜单标题/动作由 AppKit 路由和测试覆盖。当前桌面自动化
  无法稳定枚举 macOS 全局状态栏，因此没有把真实右键坐标点击记为 GUI 自动化证据。

## 内嵌 Host 基线

- Host version：`0.2.0`
- SHA-256：`5edbc26f9e924b1321feb22635707d1d2779e2971560a9cd04d04fbf2a6560be`
- configuration schemas：`[1, 2, 3]`
- Runtime protocol：`1`

## 当前边界

- 公共 config v1 不再接受，项目必须显式迁移到 v2；内部 Host schema 1/2 仅为既有应用包
  和阶段 0/1 产物保留。
- 不持久化窗口显示、焦点、最小化或全屏状态；settings 只覆盖桌面入口、状态栏 symbol、
  三个窗口标志和主窗口 frame。
- Native Bridge 只暴露当前 allowlist，不提供文件/目录选择、通知、外部打开、Keychain、
  角标、自定义菜单或多窗口。
- npm 首发、许可证和发布元数据继续由独立的阶段 1 发布门禁处理。
