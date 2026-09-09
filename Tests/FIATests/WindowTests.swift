import AppKit
import Testing

@testable import FIA

@MainActor @Suite("Web windows", .serialized)
struct WindowTests {
  @Test func stableIdsReuseWindowAndTitlebarValidationIsAtomic() throws {
    _ = NSApplication.shared
    let manager = WindowManager()
    let initial = try manager.create(WindowOptions(id: "main", title: "First"))
    #expect(initial.id == "main")
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
