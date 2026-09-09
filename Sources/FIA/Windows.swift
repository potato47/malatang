import AppKit
import Foundation
import WebKit

public enum AppWindowKind: String, Codable, Sendable {
  case web
}

public enum LastWindowClosedAction: Sendable { case keepRunning, quit }
public enum ReopenAction: Sendable { case restoreMainWindow, none }
public enum UserCloseAction: Sendable { case closeWindow, hideWindow, hideApplication }
public enum AppWindowLifecycle: String, Codable, Sendable { case registered, open, closed }
public enum AppWindowFullscreen: String, Codable, Sendable {
  case windowed, entering, fullscreen, exiting
}

public struct AppWindowState: Codable, Sendable, Equatable {
  public let id: String
  public let kind: AppWindowKind
  public let lifecycle: AppWindowLifecycle
  public let orderedIn: Bool
  public let applicationHidden: Bool
  public let miniaturized: Bool
  public let focused: Bool
  public let fullscreen: AppWindowFullscreen

  public init(
    id: String, kind: AppWindowKind, lifecycle: AppWindowLifecycle, orderedIn: Bool = false,
    applicationHidden: Bool = false, miniaturized: Bool = false, focused: Bool = false,
    fullscreen: AppWindowFullscreen = .windowed
  ) {
    self.id = id
    self.kind = kind
    self.lifecycle = lifecycle
    self.orderedIn = orderedIn
    self.applicationHidden = applicationHidden
    self.miniaturized = miniaturized
    self.focused = focused
    self.fullscreen = fullscreen
  }
}

public struct AppWindowEvent: Codable, Sendable, Equatable {
  public enum Cause: String, Codable, Sendable {
    case created, show, hide, focus, close, userClose, application, system, fullscreen
  }
  public let previous: AppWindowState
  public let current: AppWindowState
  public let cause: Cause
}

@MainActor
public protocol AppWindow: AnyObject {
  var id: String { get }
  var kind: AppWindowKind { get }
  var state: AppWindowState { get }
  func show() throws
  func hide() throws
  func focus() throws
  func close() throws
}

@MainActor
open class AppKitWindow: NSObject, AppWindow, NSWindowDelegate {
  public let id: String
  public let kind: AppWindowKind
  public let window: NSWindow
  public let userCloseAction: UserCloseAction
  private let emit: (AppWindowEvent) -> Void
  private var lifecycle: AppWindowLifecycle = .open
  private var fullscreen: AppWindowFullscreen = .windowed
  private var previous: AppWindowState
  private var performingProgrammaticChange = false
  var presentationAllowed: () -> Bool = { true }

  public var state: AppWindowState {
    AppWindowState(
      id: id, kind: kind, lifecycle: lifecycle,
      orderedIn: lifecycle == .open && window.isVisible,
      applicationHidden: NSApp?.isHidden ?? false,
      miniaturized: lifecycle == .open && window.isMiniaturized,
      focused: lifecycle == .open && window.isKeyWindow && (NSApp?.isActive ?? false)
        && !(NSApp?.isHidden ?? false),
      fullscreen: lifecycle == .open ? fullscreen : .windowed)
  }

  public init(
    id: String, kind: AppWindowKind = .web, window: NSWindow,
    userCloseAction: UserCloseAction = .closeWindow,
    emit: @escaping (AppWindowEvent) -> Void = { _ in }
  ) {
    self.id = id
    self.kind = kind
    self.window = window
    self.userCloseAction = userCloseAction
    self.emit = emit
    previous = AppWindowState(id: id, kind: kind, lifecycle: .open)
    super.init()
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.setFrameAutosaveName("fia.window.\(id)")
    fullscreen = window.styleMask.contains(.fullScreen) ? .fullscreen : .windowed
    previous = state
    for name in [
      NSApplication.didHideNotification, NSApplication.didUnhideNotification,
      NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
    ] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(applicationChanged), name: name, object: nil)
    }
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  private func change(_ cause: AppWindowEvent.Cause, action: () -> Void) {
    performingProgrammaticChange = true
    action()
    performingProgrammaticChange = false
    reconcile(cause)
  }

  private func reconcile(_ cause: AppWindowEvent.Cause) {
    guard !performingProgrammaticChange else { return }
    let current = state
    guard current != previous else { return }
    let event = AppWindowEvent(previous: previous, current: current, cause: cause)
    previous = current
    emit(event)
  }

  private func requireOpen(_ method: String) throws {
    guard lifecycle == .open else {
      throw FIAError(
        code: .unsafeState, component: "windows", method: method, message: "Window is closed: \(id)"
      )
    }
  }

  public func show() throws {
    guard presentationAllowed() else {
      throw FIAError(code: .unsafeState, component: "windows", message: "Runtime is shutting down")
    }
    try requireOpen("show")
    change(.show) {
      NSApp.unhide(nil)
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
    }
  }
  public func hide() throws {
    try requireOpen("hide")
    change(.hide) { window.orderOut(nil) }
  }
  public func focus() throws {
    guard presentationAllowed() else {
      throw FIAError(code: .unsafeState, component: "windows", message: "Runtime is shutting down")
    }
    try requireOpen("focus")
    change(.focus) {
      NSApp.unhide(nil)
      NSApp.activate(ignoringOtherApps: true)
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
    }
  }
  public func close() throws {
    try requireOpen("close")
    change(.close) { window.close() }
  }
  public func windowShouldClose(_ sender: NSWindow) -> Bool {
    switch userCloseAction {
    case .closeWindow: return true
    case .hideWindow:
      change(.userClose) { window.orderOut(nil) }
      return false
    case .hideApplication:
      change(.userClose) { NSApp.hide(nil) }
      return false
    }
  }
  public func windowWillClose(_ notification: Notification) {
    lifecycle = .closed
    reconcile(.close)
  }
  public func windowDidBecomeKey(_ notification: Notification) { reconcile(.system) }
  public func windowDidResignKey(_ notification: Notification) { reconcile(.system) }
  public func windowDidMiniaturize(_ notification: Notification) { reconcile(.system) }
  public func windowDidDeminiaturize(_ notification: Notification) { reconcile(.system) }
  public func windowDidUpdate(_ notification: Notification) { reconcile(.system) }
  public func windowWillEnterFullScreen(_ notification: Notification) {
    fullscreen = .entering
    reconcile(.fullscreen)
  }
  public func windowDidEnterFullScreen(_ notification: Notification) {
    fullscreen = .fullscreen
    reconcile(.fullscreen)
  }
  public func windowWillExitFullScreen(_ notification: Notification) {
    fullscreen = .exiting
    reconcile(.fullscreen)
  }
  public func windowDidExitFullScreen(_ notification: Notification) {
    fullscreen = .windowed
    reconcile(.fullscreen)
  }
  public func windowDidFailToEnterFullScreen(_ window: NSWindow) { syncFullscreen() }
  public func windowDidFailToExitFullScreen(_ window: NSWindow) { syncFullscreen() }
  private func syncFullscreen() {
    fullscreen = window.styleMask.contains(.fullScreen) ? .fullscreen : .windowed
    reconcile(.fullscreen)
  }
  @objc private func applicationChanged(_ notification: Notification) { reconcile(.application) }
}

public struct TitlebarItem: Codable, Sendable, Equatable {
  public let type: String
  public let id: String
  public let label: String?
  public let symbol: String?
  public let tooltip: String?
  public let enabled: Bool?
}
public struct WindowOptions: Codable, Sendable {
  public let id: String
  public var route: String?
  public var title: String?
  public var width: Double?
  public var height: Double?
  public var titlebar: [TitlebarItem]?
  public init(
    id: String, route: String? = nil, title: String? = nil, width: Double? = nil,
    height: Double? = nil, titlebar: [TitlebarItem]? = nil
  ) {
    self.id = id
    self.route = route
    self.title = title
    self.width = width
    self.height = height
    self.titlebar = titlebar
  }
}

@MainActor
public final class WebWindow: AppKitWindow, WKNavigationDelegate {
  public let webView: WKWebView
  public var route: String
  private var items: [TitlebarItem] = []
  private var buttons: [NSButton] = []
  private var action: (String, String) -> Void
  var onContentFailure: (() -> Void)?
  var origin: URL?
  var connected = false {
    didSet {
      for (button, item) in zip(buttons, items.filter { $0.type == "button" }) {
        button.isEnabled = connected && item.enabled != false
      }
    }
  }
  public init(
    options: WindowOptions, appName: String, emit: @escaping (AppWindowEvent) -> Void,
    action: @escaping (String, String) -> Void
  ) {
    route = options.route ?? "/"
    self.action = action
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    webView = WKWebView(frame: .zero, configuration: configuration)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: options.width ?? 1000, height: options.height ?? 720),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
    )
    window.title = options.title ?? appName
    window.contentView = webView
    window.center()
    super.init(id: options.id, window: window, emit: emit)
    webView.navigationDelegate = self
    if #available(macOS 13.3, *) {
      webView.isInspectable = ProcessInfo.processInfo.environment["FIA_DEVELOPMENT"] == "1"
    }
    setTitlebar(options.titlebar ?? [])
    loading()
  }
  func loading() {
    connected = false
    webView.stopLoading()
    webView.loadHTMLString(
      "<html><meta name='color-scheme' content='light dark'><body style='font:14px system-ui;display:grid;place-items:center;height:90vh'>Loading…</body></html>",
      baseURL: nil)
  }
  func load(_ url: URL) {
    origin = url
    webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    connected = true
  }
  func setTitlebar(_ items: [TitlebarItem]) {
    self.items = items
    buttons.removeAll()
    while !window.titlebarAccessoryViewControllers.isEmpty {
      window.removeTitlebarAccessoryViewController(
        at: window.titlebarAccessoryViewControllers.count - 1)
    }
    guard !items.isEmpty else { return }
    let stack = NSStackView()
    stack.orientation = .horizontal
    stack.spacing = 8
    for item in items {
      switch item.type {
      case "button":
        let button = NSButton(title: item.label ?? "", target: self, action: #selector(pressed(_:)))
        button.identifier = NSUserInterfaceItemIdentifier(item.id)
        button.bezelStyle = .texturedRounded
        if let symbol = item.symbol {
          button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: item.label)
        }
        button.toolTip = item.tooltip
        button.isEnabled = connected && item.enabled != false
        buttons.append(button)
        stack.addArrangedSubview(button)
      case "text":
        let label = NSTextField(labelWithString: item.label ?? "")
        label.toolTip = item.tooltip
        stack.addArrangedSubview(label)
      default:
        let space = NSView()
        space.widthAnchor.constraint(equalToConstant: 16).isActive = true
        stack.addArrangedSubview(space)
      }
    }
    let accessory = NSTitlebarAccessoryViewController()
    let container = NSView(
      frame: NSRect(x: 0, y: 0, width: stack.fittingSize.width + 16, height: 30))
    container.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 8),
      stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -8),
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    accessory.view = container
    accessory.layoutAttribute = .right
    window.addTitlebarAccessoryViewController(accessory)
  }
  @objc private func pressed(_ sender: NSButton) {
    if connected, let item = sender.identifier?.rawValue { action(id, item) }
  }
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    connected = false
    onContentFailure?()
  }
  public func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if (error as NSError).code != NSURLErrorCancelled { onContentFailure?() }
  }
  public func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
  ) {
    if (error as NSError).code != NSURLErrorCancelled { onContentFailure?() }
  }
  public func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    if url.absoluteString == "about:blank" {
      decisionHandler(.allow)
      return
    }
    if let origin, url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port {
      decisionHandler(.allow)
      return
    }
    if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }
}

@MainActor
public final class WindowManager {
  private var instances: [String: WebWindow] = [:]
  private var definitions: [String: WindowOptions] = [:]
  private var url: ((String, String) -> URL)?
  private var connected = false
  private var stopping = false
  public var appName = "FIA"
  public var onEvent: ((AppWindowEvent) -> Void)?
  public var onAction: ((String, String) -> Void)?
  var onContentFailure: ((String) -> Void)?
  public var states: [AppWindowState] { instances.values.map(\.state).sorted { $0.id < $1.id } }
  public var registeredIDs: [String] { definitions.keys.sorted() }
  public var openIDs: Set<String> {
    Set(instances.values.filter { $0.state.lifecycle != .closed }.map(\.id))
  }
  public func beginShutdown() { stopping = true }
  public func restoreMainWindow() throws { try operate("open", id: "main") }
  public init() {}
  func suspend() {
    connected = false
    for window in instances.values where window.state.lifecycle != .closed { window.loading() }
  }
  func connect(_ resolver: @escaping (String, String) -> URL) {
    url = resolver
    connected = true
    for window in instances.values where window.state.lifecycle != .closed {
      window.load(resolver(window.id, window.route))
    }
  }
  @discardableResult
  public func create(_ options: WindowOptions) throws -> AppWindowState {
    try validate(options)
    guard !stopping else { throw failure("Runtime is stopping") }
    if instances[options.id] != nil {
      // Re-declaring a window after Bun restarts must preserve the user's
      // geometry and open/hidden/closed state. Explicit update/open changes it.
      var declaration = options
      declaration.width = nil
      declaration.height = nil
      return try update(declaration)
    }
    definitions[options.id] = options
    let window = WebWindow(
      options: options, appName: appName, emit: { [weak self] event in self?.onEvent?(event) },
      action: { [weak self] id, item in self?.onAction?(id, item) })
    instances[options.id] = window
    window.onContentFailure = { [weak self] in self?.onContentFailure?(options.id) }
    if connected, let url { window.load(url(window.id, window.route)) }
    try window.show()
    return window.state
  }
  @discardableResult
  public func update(_ options: WindowOptions) throws -> AppWindowState {
    try validate(options)
    guard let window = instances[options.id] else {
      throw failure("Window not found: " + options.id)
    }
    var stored = definitions[options.id]!
    if let title = options.title {
      window.window.title = title
      stored.title = title
    }
    if let route = options.route, route != window.route {
      window.route = route
      stored.route = route
      if connected, window.state.lifecycle != .closed, let url {
        window.load(url(window.id, route))
      }
    }
    if let items = options.titlebar {
      window.setTitlebar(items)
      stored.titlebar = items
    }
    if options.width != nil || options.height != nil {
      window.window.setContentSize(
        NSSize(
          width: options.width ?? window.webView.frame.width,
          height: options.height ?? window.webView.frame.height))
      stored.width = options.width ?? stored.width
      stored.height = options.height ?? stored.height
    }
    definitions[options.id] = stored
    return window.state
  }
  @discardableResult
  func operate(_ operation: String, id: String) throws -> AppWindowState {
    if operation == "open", instances[id]?.state.lifecycle == .closed, let options = definitions[id]
    {
      instances.removeValue(forKey: id)
      return try create(options)
    }
    guard let window = instances[id] else { throw failure("Window not found: " + id) }
    switch operation {
    case "open", "focus": try window.focus()
    case "hide": try window.hide()
    case "close": try window.close()
    case "minimize": window.window.miniaturize(nil)
    case "maximize": if !window.window.isZoomed { window.window.zoom(nil) }
    case "restore":
      window.window.deminiaturize(nil)
      if window.window.isZoomed { window.window.zoom(nil) }
    case "toggleFullscreen": window.window.toggleFullScreen(nil)
    default: break
    }
    return window.state
  }
  func registerNativeMethods(_ registry: NativeMethodRegistry) {
    registry.register("windows.create", input: WindowOptions.self, output: AppWindowState.self) {
      [weak self] input in
      try await MainActor.run {
        guard let self else { throw CancellationError() }
        return try self.create(input)
      }
    }
    registry.register("windows.update", input: WindowOptions.self, output: AppWindowState.self) {
      [weak self] input in
      try await MainActor.run {
        guard let self else { throw CancellationError() }
        return try self.update(input)
      }
    }
    registry.register("windows.setTitlebar", input: TitlebarInput.self, output: AppWindowState.self)
    { [weak self] input in
      try await MainActor.run {
        guard let self else { throw CancellationError() }
        return try self.update(WindowOptions(id: input.id, titlebar: input.items))
      }
    }
    for method in [
      "open", "hide", "focus", "close", "state", "minimize", "maximize", "restore",
      "toggleFullscreen",
    ] {
      registry.register(
        "windows." + method, input: BuiltinWindowID.self, output: AppWindowState.self
      ) { [weak self] input in
        try await MainActor.run {
          guard let self else { throw CancellationError() }
          return try self.operate(method, id: input.id)
        }
      }
    }
  }
  private func failure(_ message: String) -> FIAError {
    FIAError(code: .invalidArgument, component: "windows", message: message)
  }
  private func validate(_ options: WindowOptions) throws {
    guard options.id.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil else {
      throw failure("Invalid window id")
    }
    if let route = options.route {
      guard route.hasPrefix("/"), !route.hasPrefix("//"), !route.contains("\\"),
        let decoded = route.removingPercentEncoding,
        !decoded.components(separatedBy: "/").contains(".."),
        !decoded.unicodeScalars.contains(where: { $0.value < 32 })
      else { throw failure("Window route must be an application path") }
    }
    for size in [options.width, options.height].compactMap({ $0 }) {
      guard size.isFinite, size >= 200, size <= 16384 else { throw failure("Invalid window size") }
    }
    if let items = options.titlebar {
      guard items.count <= 32, Set(items.map(\.id)).count == items.count else {
        throw failure("Titlebar items must have unique IDs (maximum 32)")
      }
      for item in items {
        guard ["button", "text", "spacer"].contains(item.type), !item.id.isEmpty,
          item.id.count <= 100,
          item.type == "spacer" || (item.label != nil && item.label!.count <= 256)
        else { throw failure("Invalid titlebar item") }
      }
    }
  }
}
private struct TitlebarInput: Codable, Sendable {
  let id: String
  let items: [TitlebarItem]
}
