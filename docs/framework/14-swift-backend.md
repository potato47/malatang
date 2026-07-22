# Swift 后端模式与验收

> 状态：已实现  
> 平台：macOS 14+、Apple Silicon、Swift 6

## 模式边界

`runtime: "swift"` 是与 Bun 应用后端互斥的运行模式。开发时 Bun 只负责浏览器构建和 HMR，
应用业务逻辑运行在 SwiftPM executable 中；生产应用使用 `fia-app://` 静态 UI 和应用专属
`Contents/MacOS/fia-backend`，不包含 `fia-runtime`。最终用户不需要 Bun、SwiftPM 或 Xcode。

公共项目配置保持 schema 2：

```ts
export default defineConfig({
  configVersion: 2,
  runtime: "swift",
  app: { name: "Hello", identifier: "com.example.hello" },
  ui: "src/ui/index.html",
  swift: { package: "Backend", product: "HelloBackend" },
});
```

该模式必须省略 `entry`。package 必须位于项目内并包含 `Package.swift`；product 只能是安全的
可执行文件名，且 `swift build --product` 必须实际生成可执行文件。

## 应用 API

Web UI 使用独立于 Native Bridge 的异步接口：

```ts
import { backend } from "@semicoder/fia/backend";

const value = await backend.invoke<{ name: string }, { message: string }>(
  "greet",
  { name: "FIA" },
);

const unsubscribe = backend.onEvent<{ progress: number }>(
  "sync.progress",
  payload => console.log(payload.progress),
);
```

公共模块提供 `isAvailable()`、`invoke()`、`onEvent()` 与 `FIABackendError`。应用错误使用
`APPLICATION_ERROR`，原始 Swift error code 暴露为 `applicationCode`；重启、不可用和超时分别
使用 `BACKEND_RESTARTED`、`BACKEND_UNAVAILABLE` 与 `BACKEND_TIMEOUT`。

Swift SDK 随 npm 包发布在 `swift/`：

```swift
import FIABackend

@main
struct HelloBackend {
    static func main() async throws {
        let application = BackendApplication()
        application.handle("greet", input: GreetRequest.self, output: GreetResponse.self) {
            request, context in
            context.logger.info("Greeting \(request.name)")
            try await context.emit(name: "greet.completed", payload: request)
            return GreetResponse(message: "Hello, \(request.name)")
        }
        try await application.run()
    }
}
```

`BackendContext` 提供应用数据目录、request ID、stderr logger、取消状态与事件发送。输入、输出、
事件和 error details 只支持 JSON 可表达的 Codable 数据；首版不生成 Swift/TypeScript 类型。

## Host 协议与生命周期

Host 内部配置升级为 schema 4，将 UI Runtime 和 Backend 分开；Host 继续兼容 schema 1–3。
`fiaNative` 与 `fiaBackend` 是两个独立的 WebKit handler，都只接受当前应用精确 origin 的主
frame。任意应用 RPC 不进入桌面原生命令 allowlist。

Host 拥有后端进程并使用 stdin/stdout NDJSON：

- Host → Backend：`initialize`、`request`、`shutdown`
- Backend → Host：`ready`、`response`、`event`
- stderr：仅日志
- 单条消息最大 1 MiB，最多 128 个并发请求，RPC 默认超时 30 秒
- 未知字段、错误 PID、重复或未知 response、超限和非法 JSON 都视为协议错误并终止后端
- 退出顺序为 shutdown，2 秒后 SIGTERM，再 2 秒后 SIGKILL
- stdin EOF 时 SDK 自动取消请求并退出

首次加载只有在 UI Runtime 与 Backend 都 ready 后才进入 WebView。首次失败提供 Retry/Quit；
页面运行期间后端崩溃会保留窗口和前端，并进入可重启的后端故障状态。

## 构建与开发重载

生产构建使用 release/arm64，先签名 `fia-backend`，再签名 Host 和整个 `.app`。全部编译、架构、
权限和签名验证完成前不会替换现有 `dist`。

开发构建使用 debug/arm64。CLI 监听 `Package.swift`、`Package.resolved` 与 `Sources/`，执行 200 ms
防抖和串行构建。失败时当前后端继续服务；成功时 CLI 向 Host 发送内部 `SIGUSR1`，Host 平滑
重启后端但不重载 WebView 或 Bun HMR Runtime。重启中的未完成请求返回 `BACKEND_RESTARTED`。

`fia doctor` 在 Swift 项目内把 Swift 6 提升为必需检查；Bun 和 UI-only 项目仍将 Swift 显示为
可选开发工具。

## 自动化验收

- 公共配置覆盖三种 runtime、互斥字段、package 越界/缺失和非法 product。
- Swift 脚手架覆盖 React 类型检查与 Swift debug build。
- SDK 管道测试覆盖 Codable、请求解码、乱序并发、应用错误、事件、消息/并发限制、EOF 和 shutdown。
- Host 测试覆盖 schema 4、Bridge/进程协议严格解码与 schema 1–3 回归。
- 生产端到端测试实际启动打包后的 `fia-backend`，完成 ready、RPC、事件和 shutdown，并验证
  `.app` 含 `fia-backend`、静态 UI、有效签名和 arm64 架构，但不含 `fia-runtime`。
- 根级 `bun run check` 同时运行 TypeScript、CLI、Bun Runtime、Host 和 Swift SDK 测试。
