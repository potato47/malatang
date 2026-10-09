import AppKit
import Testing
import WebKit

@testable import FIA

@MainActor @Suite("Web windows", .serialized)
struct WindowTests {
  @Test(.timeLimit(.minutes(1))) func mainWindowUserClosePreservesPageOnReopen() async throws {
    _ = NSApplication.shared
    let manager = WindowManager()
    let title = "Close and reopen \(UUID().uuidString)"
    _ = try manager.create(WindowOptions(id: "main", title: title))
    defer { _ = try? manager.operate("close", id: "main") }
    let nativeWindow = try #require(NSApp.windows.first { $0.title == title })
    let window = try #require(nativeWindow.delegate as? WebWindow)
    var loads = 0
    manager.connect { _, _ in
      loads += 1
      return URL(string: "about:blank")!
    }
    try await waitForPage(
      window.webView,
      condition: "document.readyState === 'complete' && document.body?.textContent === ''")
    #expect(
      try await evaluateBoolean(
        window.webView,
        script: "window.fiaDraft = 'unsaved draft'; document.body.textContent = window.fiaDraft; true"))

    for _ in 0..<3 {
      try manager.restoreMainWindow()
      #expect(nativeWindow.isVisible)
      // Both the red close button and Command-W dispatch performClose.
      nativeWindow.performClose(nil)
      #expect(!nativeWindow.isVisible)
      #expect(window.state.lifecycle == .open)
      #expect(manager.openIDs == ["main"])

      // This is the same restore path used by the Dock reopen delegate.
      try manager.restoreMainWindow()
      #expect(nativeWindow.isVisible)
      #expect(nativeWindow.contentView === window.webView)
      #expect(loads == 1)
      #expect(
        try await evaluateBoolean(
          window.webView,
          script: "window.fiaDraft === 'unsaved draft' && document.body.textContent === window.fiaDraft"))
    }
    _ = try manager.operate("close", id: "main")
    #expect(window.state.lifecycle == .closed)
    #expect(manager.openIDs.isEmpty)
  }

  @Test func auxiliaryWindowUserCloseStillCloses() throws {
    _ = NSApplication.shared
    let window = WebWindow(
      options: WindowOptions(id: "auxiliary"), appName: "FIA", emit: { _ in },
      action: { _, _ in })
    defer { try? window.close() }
    try window.show()
    window.window.performClose(nil)
    #expect(window.state.lifecycle == .closed)
    #expect(!window.window.isVisible)
  }

  @Test(.timeLimit(.minutes(1))) func viewportDoesNotBounceButContentStillScrolls() async throws {
    _ = NSApplication.shared
    for id in ["scroll-main", "scroll-aux"] {
      let window = WebWindow(
        options: WindowOptions(id: id, width: 400, height: 300), appName: "FIA",
        emit: { _ in }, action: { _, _ in })
      defer { try? window.close() }
      try await waitForPage(
        window.webView,
        condition: """
          document.body?.textContent.includes('Loading') &&
          getComputedStyle(document.documentElement).overscrollBehaviorX === 'none' &&
          getComputedStyle(document.documentElement).overscrollBehaviorY === 'none'
          """)
      // Permit this test-only srcdoc fixture; FIA navigation policy deliberately
      // restricts application navigation to the backend origin.
      window.webView.navigationDelegate = nil
      window.webView.loadHTMLString(
        """
        <!doctype html><html><body data-fixture="long" style="margin:0;width:2000px;height:2000px">
          <div id="nested" style="width:160px;height:100px;overflow:auto">
            <div style="width:1000px;height:1000px">Scrollable</div>
          </div>
          <iframe srcdoc="<!doctype html><html><body>Frame</body></html>"></iframe>
        </body></html>
        """, baseURL: nil)
      try await waitForPage(
        window.webView,
        condition: """
          document.body?.dataset.fixture === 'long' &&
          document.querySelector('iframe')?.contentDocument?.body?.textContent === 'Frame' &&
          getComputedStyle(document.documentElement).overscrollBehavior === 'none' &&
          document.querySelector('iframe').contentWindow.getComputedStyle(
            document.querySelector('iframe').contentDocument.documentElement
          ).overscrollBehavior === 'none'
          """)
      #expect(
        try await evaluateBoolean(
          window.webView,
          script: """
            (() => {
              window.scrollTo(100, 150);
              const nested = document.getElementById('nested');
              nested.scrollTo(70, 80);
              return window.scrollX === 100 && window.scrollY === 150 &&
                nested.scrollLeft === 70 && nested.scrollTop === 80 &&
                getComputedStyle(nested).overscrollBehavior === 'auto';
            })()
            """))
      // A replacement document with no scrollable content and strict CSP still
      // receives the host policy, without requiring an app stylesheet.
      window.webView.loadHTMLString(
        """
        <!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'">
        </head><body data-fixture="short">Short page</body></html>
        """, baseURL: nil)
      try await waitForPage(
        window.webView,
        condition: """
          document.body?.dataset.fixture === 'short' &&
          getComputedStyle(document.documentElement).overscrollBehaviorX === 'none' &&
          getComputedStyle(document.documentElement).overscrollBehaviorY === 'none' &&
          document.documentElement.scrollHeight <= window.innerHeight &&
          document.documentElement.scrollWidth <= window.innerWidth
          """)
    }
  }

  private func evaluateBoolean(_ webView: WKWebView, script: String) async throws -> Bool {
    try await withCheckedThrowingContinuation { continuation in
      webView.evaluateJavaScript(script) { result, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: result as? Bool ?? false)
        }
      }
    }
  }

  private func waitForPage(_ webView: WKWebView, condition: String) async throws {
    for _ in 0..<200 {
      if (try? await evaluateBoolean(webView, script: "Boolean(\(condition))")) == true { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    Issue.record("WebView did not satisfy: \(condition)")
    throw CocoaError(.validationMissingMandatoryProperty)
  }

  @Test func stableIdsReuseWindowAndTitlebarValidationIsAtomic() throws {
    _ = NSApplication.shared
    let manager = WindowManager()
    let initial = try manager.create(WindowOptions(id: "main", title: "First"))
    #expect(initial.id == "main")
    #expect(!initial.orderedIn) // Declaration must not present a window during CLI startup.
    _ = try manager.create(WindowOptions(id: "main", title: "Second"))
    #expect(manager.registeredIDs == ["main"])
    let items = [
      TitlebarItem(
        type: "button", id: "copy", label: "Copy", symbol: "doc.on.doc", tooltip: "Copy",
        enabled: true)
    ]
    _ = try manager.update(WindowOptions(id: "main", titlebar: items))
    #expect(throws: (any Error).self) {
      try manager.update(WindowOptions(id: "main", titlebar: items + items))
    }
    #expect(throws: (any Error).self) {
      try manager.update(WindowOptions(id: "main", route: "https://example.com"))
    }
    manager.suspend()
    #expect(manager.openIDs == ["main"])
    _ = try manager.operate("close", id: "main")
    #expect(manager.openIDs.isEmpty)
    _ = try manager.create(WindowOptions(id: "main", title: "Rebound"))
    _ = try manager.update(WindowOptions(id: "main", titlebar: items))
    #expect(manager.openIDs.isEmpty)
    try manager.restoreMainWindow()
    #expect(manager.openIDs == ["main"])
    _ = try manager.operate("close", id: "main")
  }
  @Test func titlebarDisablesDuringReconnectAndDeliversStableActionIDs() throws {
    _ = NSApplication.shared
    var actions: [String] = []
    let window = WebWindow(
      options: WindowOptions(id: "buttons"), appName: "FIA", emit: { _ in },
      action: { id, item in actions.append(id + ":" + item) })
    let items = [
      TitlebarItem(
        type: "button", id: "save", label: "Save", symbol: nil, tooltip: "Save file", enabled: true)
    ]
    window.setTitlebar(items)
    let stack = try #require(
      window.window.titlebarAccessoryViewControllers.first?.view.subviews.first as? NSStackView)
    let button = try #require(stack.arrangedSubviews.first as? NSButton)
    #expect(!button.isEnabled)
    window.connected = true
    button.performClick(nil)
    #expect(actions == ["buttons:save"])
    window.loading()
    #expect(!button.isEnabled)
    button.performClick(nil)
    #expect(actions.count == 1)
    window.setTitlebar(items)
    #expect(window.window.titlebarAccessoryViewControllers.count == 1)
    var failed = false
    window.onContentFailure = { failed = true }
    window.webViewWebContentProcessDidTerminate(window.webView)
    #expect(failed)
    try window.close()
  }
  @Test func browserButtonSurvivesCustomTitlebarAndFollowsConnectionState() throws {
    _ = NSApplication.shared
    var opened: [String] = []
    let window = WebWindow(options: WindowOptions(id: "browser", route: "/detail?q=1"),
      appName: "FIA", emit: { _ in }, action: { _, _ in }, browserAction: { opened.append($0) })
    func button() throws -> NSButton {
      let stack = try #require(window.window.titlebarAccessoryViewControllers.first?.view.subviews.first as? NSStackView)
      let button = try #require(stack.arrangedSubviews.last as? NSButton)
      #expect(button.identifier?.rawValue == "fia.openInBrowser")
      return button
    }
    #expect(try !button().isEnabled)
    window.connected = true
    try button().performClick(nil)
    #expect(opened == ["browser"])
    window.browserOpening = true
    #expect(try !button().isEnabled)
    window.setTitlebar([TitlebarItem(type: "text", id: "status", label: "Ready", symbol: nil, tooltip: nil, enabled: nil)])
    #expect(try !button().isEnabled)
    window.browserOpening = false
    #expect(try button().isEnabled)
    window.setTitlebar([])
    #expect(window.window.titlebarAccessoryViewControllers.count == 1)
    try button().performClick(nil)
    #expect(opened == ["browser", "browser"])
    window.loading()
    #expect(try !button().isEnabled)
    try window.close()
    let manager = WindowManager()
    _ = try manager.create(WindowOptions(id: "main", route: "/detail?q=1"))
    #expect(try manager.browserRoute("main") == "/detail?q=1")
    #expect(throws: (any Error).self) { try manager.browserRoute("missing") }
    _ = try manager.operate("close", id: "main")
  }
  @Test func registryCancelsNativeCallsWithoutPoisoningNextGeneration() async throws {
    let registry = NativeMethodRegistry()
    registry.register("slow", input: FIAEmpty.self, output: FIAEmpty.self) { _ in
      try await Task.sleep(for: .seconds(10))
      return FIAEmpty()
    }
    let request = Task { await registry.dispatch(method: "slow", params: Data("{}".utf8)) }
    await Task.yield()
    registry.cancelActive()
    if case .success = await request.value {
      Issue.record("Cancelled operation unexpectedly succeeded")
    }
    registry.register("ready", input: FIAEmpty.self, output: FIAEmpty.self) { _ in FIAEmpty() }
    if case .failure = await registry.dispatch(method: "ready", params: Data("{}".utf8)) {
      Issue.record("New generation could not use registry")
    }
  }
}
