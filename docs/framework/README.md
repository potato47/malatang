# FIA 框架设计

> 当前边界：公共 config 5、Host config 8、stdio protocol 2

FIA 是 Swift 状态栏宿主中的常驻 Bun 服务容器：

```text
System Browser / WKWebView
          │ HTTP + WebSocket
          ▼
  standalone Bun Backend
          │ JSONL stdio
          ▼
 Swift/AppKit status bar Host
```

网页没有 FIA runtime 或原生桥。Backend 拥有业务、HTTP/WS 和原生能力调用；Host 只负责
进程监管、状态栏、Dock、WebView、全局快捷键、屏幕截图、通知、文件面板、剪贴板、Keychain
与系统打开操作。

1. [产品范围](./01-product-scope.md)
2. [系统架构](./02-architecture.md)
3. [CLI 与项目](./03-cli-and-project.md)
4. [Backend 生命周期](./04-runtime-lifecycle.md)
5. [Host 原生能力](./05-native-capabilities.md)
6. [安全边界](./06-security.md)
7. [构建与发布](./07-build-and-release.md)
8. [路线图](./08-roadmap.md)
9. [架构决策](./09-architecture-decisions.md)
