# 阶段 1 CLI MVP 验收基线

> 记录日期：2026-07-19  
> 状态：本地包与 macOS arm64 主流程已通过；npm 首次公开安装仍待验收

本文记录阶段 1 `fia create/dev/run/build/doctor` 的实现与验收结果。阶段 0 的历史风险原型
证据继续保留在[阶段 0 验证基线](./11-phase0-validation.md)，不使用当前测试数量覆盖历史记录。

## 验收环境

| 项目 | 已验证值 |
| --- | --- |
| macOS | 26.5.2（Build 25F84） |
| CPU | Apple Silicon，arm64 |
| Bun | 1.3.14（0d9b296a） |
| Swift | 6.3.2，Swift tools 6.0 package |
| 最低部署目标 | macOS 14.0 |
| Host 分发 | CLI 内嵌 arm64 预编译 Host、manifest 与 SHA-256 |
| 应用签名 | ad-hoc，内层到外层签名并严格验证 |

## 自动化证据

| 验证 | 结果 |
| --- | --- |
| `bun run typecheck` | 通过 |
| `bun run test:cli` | 41 项通过，包含配置、模板、构建、Runtime HMR 与发布元数据 |
| `bun run test:runtime` | 11 项通过 |
| `bun run test:host` | 12 项通过，覆盖内部配置 schema 1/2 |
| `bun run release:npm --dry-run` | 完整检查通过；npm 识别 20 个文件，未发布版本 |

发布预演确认包名为 `@semicoder/fia@0.1.0`，包含 CLI、类型声明、React 模板、托管 Runtime、
arm64 Host 与 manifest。tarball 约 163.8 KB，解包约 597.9 KB。发布命令显式使用
`https://registry.npmjs.org/`，不继承依赖安装镜像作为发布目标。

## macOS 主流程验收

- 使用本地包引用生成 React/Bun 项目，模板无需 Xcode 工程即可类型检查和运行。
- `fia dev` 成功启动原生 Host；React UI 修改触发 HMR，Host 与 Runtime 不重启。
- 服务路由热更新后 Runtime PID、bootstrap 会话和 Host 保持不变。
- `fia build` 生成可双击的 arm64 `.app`；Info.plist、Host checksum、可执行权限和严格
  codesign 验证通过，重复构建能够原子替换产物。
- `fia run` 使用当前源码和生产协议启动临时应用，运行前后 `dist` 内容摘要不变。
- Command-Q、CLI SIGINT、Host 异常和 Runtime 异常场景完成回收，没有残留 PID。
- HTTP Hello、认证后的应用 WebSocket Echo、bootstrap/session/control token 边界通过。

## 当前阶段边界

- 只支持 macOS 14+、Apple Silicon 和 Bun 1.3.14+。
- 只输出 ad-hoc 签名的本地 `.app`；Developer ID、hardened runtime、公证、ZIP/DMG 属于阶段 3。
- Runtime 异常时 Host 显示诊断页并允许用户手动重试；自动退避重启和 native watchdog 尚未实现。
- 当前应用通信 API 是 HTTP routes/fetch 与应用 WebSocket；native bridge 属于阶段 2。
- 默认 npm 安装仍未验收，因为 `@semicoder/fia` 尚未完成首次公开发布。

## 阶段 1 剩余出口

1. 选择并添加开源许可证，补齐 npm 仓库链接等发布元数据，确认 `@semicoder` scope 与 2FA。
2. 从干净工作树运行 `bun run release:npm`，公开发布 `@semicoder/fia`。
3. 在仓库外全新目录从 npm 安装该版本，执行默认 `fia create hello`。
4. 对 npm 安装后的项目重新执行 `dev/run/build`、签名验证与无残留进程检查。
5. 为构建失败增加明确的阶段标签和可选诊断目录；该项不阻塞 npm 首次安装验收。

以上完成后，阶段 1 可以标记为全部完成并冻结公共配置、Runtime API，以及内部 protocol 1
与 schema 2 兼容基线。
