# FIA 开发 TODO

- 最后更新：2026-07-19
- 当前基线：阶段 0 风险原型与阶段 1 CLI MVP 本地主流程均已验收
- 当前重点：`@semicoder/fia` 首次公开发布、独立安装验收与阶段 2 API 设计

本文档用于跟踪执行进度。范围和阶段定义以[路线图](docs/framework/08-roadmap.md)为准，已经形成的约束以[架构决策记录](docs/framework/09-architecture-decisions.md)为准。

## 维护约定

- `[x]` 表示已经实现并完成对应验证；`[ ]` 表示尚未完成。
- `P0` 是当前里程碑的阻塞项，`P1` 是应在当前阶段完成的项目，`P2` 可以延后。
- 完成任务时同步补充测试、文档和验收证据，而不是只勾选代码实现。
- 新需求先确认所属阶段；不把阶段 2 及以后的能力提前塞入 CLI MVP。
- 只有跨应用复用的 UI 基础设施进入框架；场景代码保留在独立应用或示例中。

## 进度总览

| 阶段 | 状态 | 交付目标 |
| --- | --- | --- |
| 阶段 0：风险原型 | 已完成 | AppKit Host、Bun standalone Runtime、安全启动协议和 `.app` 生命周期闭环 |
| 阶段 1：CLI MVP | 本地主流程已验收（待 npm 首发安装验收） | `fia create/dev/run/build/doctor`，用户无需打开 Xcode |
| 阶段 2：原生桌面能力 | 已规划 | Dock/状态栏模式、窗口能力和最小原生桥接 |
| 阶段 3：发布工程 | 已规划 | Developer ID、hardened runtime、公证、DMG 和 CI |
| 阶段 4：平台化 | 远期 | 原生插件、通用架构、watchdog、更新器和平台服务 |

## 阶段 0：已完成基线

### 协议与安全

- [x] 定义 Host 与 Runtime 的 stdin/stdout NDJSON 生命周期协议。
- [x] 使用 stdin 传输 bootstrap/control token，避免把秘密写入子进程环境。
- [x] 校验 ready 协议版本、端口、PID、消息长度和 10 秒启动超时。
- [x] 实现一次性 bootstrap token、会话 cookie 和独立 control token。
- [x] 对 HTTP 和 WebSocket 请求执行精确 Host、Origin、cookie 和子协议检查。
- [x] 限制请求体、WebSocket payload、空闲时间和 backpressure。

### Host 与 Runtime

- [x] 建立 Swift tools 6.0、macOS 14、arm64 的 AppKit Host 和可测试 Host Core。
- [x] 程序化创建主菜单、`NSWindow`、`WKWebView` 和原生诊断页。
- [x] 限制 WebView 主 frame 导航；外部 HTTP(S) 链接交给系统浏览器。
- [x] 建立固定 Bun 1.3.14 的单文件 Runtime，并内嵌 HTML、TypeScript 和 CSS。
- [x] 示例 UI 展示认证状态、HTTP Hello、WebSocket Echo 和错误状态。
- [x] 实现手动重启 Runtime 和退出操作，不进行自动重启。
- [x] 实现 graceful shutdown → SIGTERM → SIGKILL 分级退出。
- [x] Host 异常退出后，Runtime 能通过 stdin EOF 自行退出。

### 构建与验收

- [x] 提供 `prototype:build`、`prototype:verify`、`prototype:lifecycle` 和统一 `check` 脚本。
- [x] 在 `.fia/build/<build-id>/` 构建并原子替换 `dist/FIAPrototype.app`。
- [x] 完成 Runtime、Host 和外层 `.app` 的 ad-hoc 签名。
- [x] 验证 Info.plist、严格签名和 arm64 架构。
- [x] Bun Runtime 测试通过：11 项。
- [x] Swift Host Core 测试通过：10 项。
- [x] 生命周期测试通过：正常退出、Host SIGKILL、Runtime SIGKILL 三种场景。
- [x] Finder/GUI 验收通过：HTTP Hello 与 WebSocket Echo 正常，Command-Q 后无残留进程。

## 阶段 1：CLI MVP 工作队列

### 1. 固化阶段 0 基线

- [x] **P0** 将当前阶段 0 文件纳入版本控制并形成可回退的基线提交。
- [x] **P0** 记录本机验证环境和已知限制，确保后续 CLI 重构不降低现有验收标准。
- [x] **P1** 为协议与构建产物增加显式兼容版本，CLI、Host、Runtime 不匹配时尽早失败。

### 2. 公共配置与项目模型

- [x] **P0** 定义首版 `fia.config.ts` 公共 schema 和 `defineConfig` 类型入口。
- [x] **P0** 明确必填项、默认值、未知字段策略、路径解析和错误展示。
- [x] **P0** 将阶段 0 内部 `fia-config.json` 与公共配置模型隔离。
- [x] **P0** 为合法配置、缺失字段、未知字段、错误类型和版本不兼容补充测试。
- [x] **P1** 设计配置版本升级入口；MVP 使用 `configVersion` 并对不兼容版本报错。

### 3. CLI 骨架与诊断

- [x] **P0** 建立可发布的 `fia` CLI 包、命令路由、`--help` 和 `--version`。
- [x] **P0** 统一日志前缀、错误格式、退出码和 debug 输出。
- [x] **P0** 实现 `fia doctor`，检查 macOS、架构、Bun、Xcode/Swift、签名工具和目录权限。
- [x] **P1** 为 CLI 参数解析、错误码和诊断结果增加自动化测试。

### 4. 创建与运行闭环

- [x] **P0** 确定 React 默认 UI 模板并实现 `fia create <name>`。
- [x] **P0** 生成 FIA 托管的 React 项目、配置、示例 HTTP 接口和 WebSocket Echo 页面。
- [x] **P0** 实现 `fia run`，按生产模式启动 Host 与 Runtime。
- [x] **P0** 实现 `fia dev`，组装临时 `.app` 并启动开发模式。
- [x] **P0** 接入 Bun HMR，验证前端修改无需重启 Host 或 Runtime。
- [x] **P1** 聚合 CLI、Host、Runtime 和 WebView 的开发日志。
- [x] **P1** 正确处理 Command-Q、CLI 中断、Runtime 崩溃和 Host 崩溃，不残留进程。

### 5. 正式构建闭环

- [x] **P0** 把阶段 0 构建逻辑抽成可复用、可测试的内部构建流水线。
- [x] **P0** 实现 `fia build`，从用户配置生成独立 `.app`。
- [x] **P0** 打包预编译 arm64 Host，并校验 Host、Runtime 和协议版本。
- [x] **P0** 保持临时目录构建、签名顺序、严格验证和原子产物替换。
- [x] **P1** 为路径包含空格、非 ASCII 应用名、构建失败清理和重复构建补充测试。
- [ ] **P1** 让失败信息指出具体构建阶段，并保留可选诊断目录。

### 6. 阶段 1 验收

- [x] 使用本地包引用生成全新 React 项目，模板类型检查、HTTP 与 WebSocket 示例通过。
- [ ] 从 npm 安装已发布的 `@semicoder/fia` 后，在仓库外执行默认 `fia create hello` 与 `bun install`，无需本地包引用。
- [x] 执行 `fia dev` 后窗口成功加载，修改 UI 能触发 HMR。
- [x] 修改服务路由后 Runtime PID、Host 和会话保持不变，后端 HMR 生效。
- [x] 执行 `fia run` 后使用与正式构建一致的生产启动协议。
- [x] `fia run` 不生成或修改 `dist`，退出后临时产物和 PID 均被清理。
- [x] 执行 `fia build` 后得到可双击启动、签名与架构验证通过的 `.app`。
- [x] 重复构建、非 ASCII 应用名、CLI 中断与崩溃回收场景通过。
- [x] 用户全流程不需要创建或打开 Xcode 工程。
- [x] HTTP Hello、WebSocket Echo、异常恢复和无残留进程回归通过。
- [x] 根目录 `bun run release:npm --dry-run` 通过，npm 识别 20 个发布文件且未实际发布。
- [ ] **P0** 选择并添加开源许可证，补齐 npm `repository`、`homepage`、`bugs` 等发布元数据。
- [ ] **P0** 确认 npm `@semicoder` scope 发布权限并启用发布 2FA。
- [ ] 正式公开发布 `@semicoder/fia`，并验证 npm 页面、dist-tag 和全新目录安装。
- [x] 当前自动化基线通过：CLI 41 项、Runtime 11 项、Swift Host 12 项。
- [x] README 和框架文档更新为真实 CLI 用法。

## 建议的近期执行顺序

1. 已形成阶段 0 版本控制基线，并记录验证环境、限制和验收证据。
2. 已建立 `@semicoder/fia`、最小命令路由和 `fia doctor`。
3. 已定稿 `fia.config.ts` 和 React 默认模板，并实现 `fia create`。
4. 已完成 `fia build`、预编译 Host、`fia run`、`fia dev`、HMR 与日志聚合。
5. 确定许可证并补齐 npm/Git 仓库元数据，确认 `@semicoder` scope 与 2FA。
6. 提交发布版本并从根目录正式发布 `@semicoder/fia`。
7. 在完全独立目录验证 npm 安装、默认 `fia create`、`dev/run/build` 与进程回收。
8. 为构建失败补充分阶段错误与可选诊断目录，保持阶段 1 回归绿灯。
9. 冻结阶段 1 公共 API，进入阶段 2 native bridge 与桌面能力设计。

## 阶段 1 收尾决策

- [x] **框架名称**：正式使用 FIA Framework、`fia` 命令和 `@semicoder/fia` 包名。
- [x] **默认 UI 模板**：首版使用 React；阶段 0 的 vanilla 页面不构成承诺。
- [x] **HTTP/WS 职责边界**：普通请求、命令调用和下载使用 HTTP；双向实时事件使用应用 WebSocket；Host 生命周期与 FIA 内部控制不复用业务通道。
- [x] **Host 分发方式**：CLI 内嵌版本化 arm64 Host，并使用 manifest 与 SHA-256 校验。
- [x] **最低系统版本**：阶段 1 固定 macOS 14+；长期支持范围移到阶段 3 发布工程复审。

以下决策不阻塞阶段 1，继续保留在后续阶段：原生插件 ABI/API、更新器信任模型、watchdog 默认策略。

## 后续阶段规划

### 阶段 2：原生桌面能力

- [ ] 支持 Dock、状态栏和混合模式。
- [ ] 完成关闭隐藏、置顶、Spaces、全屏和窗口状态恢复。
- [ ] 提供文件选择、通知、外部打开、Keychain 和最小原生桥接。
- [ ] 建立菜单/托盘事件与前端状态同步测试。

### 阶段 3：发布工程

- [ ] 启用 Developer ID、hardened runtime 和最小 entitlement。
- [ ] 产出 ZIP/DMG，完成 notarization、staple 和 Gatekeeper 验证。
- [ ] 建立产物清单、可复现构建信息和 CI 自动验证。

### 阶段 4：平台化

- [ ] 设计原生插件 SDK 与版本兼容策略。
- [ ] 增加 universal binary、watchdog、自动更新和回滚。
- [ ] 增加全局快捷键、登录启动和数据迁移机制。

## 每次合并前的完成标准

- [ ] 代码格式化、类型检查和单元测试通过。
- [ ] 对应生命周期或端到端场景通过。
- [ ] 没有引入秘密泄漏、跨 origin 放行或残留子进程。
- [ ] 用户可见行为、配置或协议变化已经更新文档。
- [ ] 构建产物不误提交到版本库。

常用验证命令：

```bash
bun install --frozen-lockfile
bun run check
bun run prototype:build
bun run prototype:verify
bun run prototype:lifecycle
```
