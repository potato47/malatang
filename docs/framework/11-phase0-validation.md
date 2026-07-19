# 阶段 0 验证基线

> 基线提交：`fd6c4b4fabe465cc068bc16ded9591e5e15eb634`  
> 记录日期：2026-07-19  
> 状态：阶段 1 的强制回归基线

本文记录进入阶段 1 时已经验证的环境、命令和限制。后续 CLI、Host 或 Runtime 重构不得
降低这些验收标准。当前阶段 1 的测试数量与主流程结果见
[阶段 1 CLI MVP 验收基线](./12-phase1-cli-mvp-validation.md)。

## 验证环境

| 项目 | 已验证值 |
| --- | --- |
| macOS | 26.5.2（Build 25F84） |
| CPU | Apple Silicon，arm64 |
| Bun | 1.3.14（0d9b296a） |
| Xcode | 26.5（Build 17F42） |
| Swift | 6.3.2，Swift tools 6.0 package |
| 最低部署目标 | macOS 14.0 |
| Host/Runtime 架构 | arm64 |
| 签名方式 | ad-hoc，本地严格验证 |

## 自动化证据

| 验证 | 结果 |
| --- | --- |
| `bun run typecheck` | 通过 |
| `bun run test:cli` | 15 项通过 |
| `bun run test:runtime` | 11 项通过 |
| `bun run test:host` | 10 项通过 |
| `bun run prototype:build` | `.app` 组装、内层到外层签名和原子替换通过 |
| `bun run prototype:verify` | Info.plist、严格签名和 arm64 架构通过 |
| `bun run prototype:lifecycle` | 正常退出、Host SIGKILL、Runtime SIGKILL 三种场景通过 |

阶段 0 的人工 GUI 验收已经在该基线提交前完成：Finder 启动、HTTP Hello、WebSocket Echo
和 Command-Q 均正常，退出后无残留 Host 或 Runtime。该人工结果作为历史基线保留；自动化
回归由上表命令持续执行。

## 已知限制

- 仅支持 macOS 14+ 和 Apple Silicon；没有 x64 或 Universal Binary。
- Runtime 固定 Bun 1.3.14，升级前必须重新执行协议、安全、签名和生命周期验证。
- `fia-config.json` schema 1 和 Runtime protocol 1 是阶段 0 内部协议；阶段 1 Host 同时支持
  带 runtime 模式的内部 schema 2，二者都不是公共项目配置。
- 只验证 ad-hoc 本地签名；Developer ID、hardened runtime、公证和 DMG 属于阶段 3。
- 阶段 0 页面是 vanilla UI，不代表阶段 1 默认模板选择。
- 本文记录的阶段 0 原型仍从源码构建；阶段 1 普通项目已改用 CLI 内嵌、带 manifest 和
  SHA-256 校验的预编译 Host。
- 阶段 0 基线本身不包含公共 CLI；阶段 1 已增加 `doctor`、配置、`create/dev/run/build` 和
  Host 内 HMR。状态栏、native bridge 和自动恢复策略仍未实现。

## 受限执行环境说明

Runtime HTTP/WebSocket 测试需要在 `127.0.0.1:0` 打开临时回环端口。禁止本地监听的沙箱会
把该操作表现为 `EADDRINUSE`，允许回环监听后同一测试可正常通过。SwiftPM 还需要可写的
模块缓存，并可能启动自己的构建沙箱；CI 或代理环境应显式提供可写 cache 路径和相应权限。
