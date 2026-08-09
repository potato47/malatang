import AppKit
import FIAHostCore
import WebKit

@MainActor
final class HostWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    enum CloseBehavior { case hide, close }

    let windowID: String
    private var closeBehavior: CloseBehavior
    private let webView: WKWebView
    private var navigationPolicy: NavigationPolicy
    private var currentURL: URL
    private var alwaysOnTop: Bool
    private var visibleOnAllSpaces: Bool
    private var visibleOverFullScreen: Bool

    var onStateChanged: (() -> Void)?
    var onFrameChanged: (() -> Void)?
    var onClosed: (() -> Void)?

    var currentFrame: DesktopWindowFrame? {
        guard let frame = window?.frame else { return nil }
        return DesktopWindowFrame(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height)
    }

    init(
        id: String,
        url: URL,
        title: String,
        width: Double,
        height: Double,
        minWidth: Double,
        minHeight: Double,
        restoredFrame: DesktopWindowFrame?,
        dataStore: WKWebsiteDataStore,
        closeBehavior: CloseBehavior,
        alwaysOnTop: Bool,
        visibleOnAllSpaces: Bool,
        visibleOverFullScreen: Bool,
        inspectable: Bool
    ) {
        windowID = id
        currentURL = url
        navigationPolicy = NavigationPolicy(origin: url)
        self.closeBehavior = closeBehavior
        self.alwaysOnTop = alwaysOnTop
        self.visibleOnAllSpaces = visibleOnAllSpaces
        self.visibleOverFullScreen = visibleOverFullScreen
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.minSize = NSSize(width: minWidth, height: minHeight)
        if let restoredFrame,
           let constrained = Self.constrainedFrame(
            restoredFrame,
            minimumSize: window.minSize,
            screens: NSScreen.screens.map(\.visibleFrame)
           ) {
            window.setFrame(constrained, display: false)
        } else {
            window.center()
        }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = inspectable
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        applyFlags()
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func show() {
        showWindow(nil)
        window?.orderFront(nil)
        onStateChanged?()
    }

    func focus() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        onStateChanged?()
    }

    func hide() {
        window?.orderOut(nil)
        onStateChanged?()
    }

    func navigate(to url: URL) {
        currentURL = url
        navigationPolicy = NavigationPolicy(origin: url)
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
        onStateChanged?()
    }

    func update(
        title: String?,
        width: Double? = nil,
        height: Double? = nil,
        minWidth: Double? = nil,
        minHeight: Double? = nil,
        closeBehavior: CloseBehavior? = nil,
        alwaysOnTop: Bool?,
        visibleOnAllSpaces: Bool?,
        visibleOverFullScreen: Bool?
    ) throws {
        guard let window else {
            throw HostRequestExecutionError(code: .nativeFailure, message: "WebView window is unavailable")
        }
        let nextMinimum = NSSize(
            width: minWidth ?? window.minSize.width,
            height: minHeight ?? window.minSize.height
        )
        let currentContentSize = window.contentLayoutRect.size
        let nextContentSize = NSSize(
            width: width ?? max(currentContentSize.width, nextMinimum.width),
            height: height ?? max(currentContentSize.height, nextMinimum.height)
        )
        guard nextContentSize.width >= nextMinimum.width, nextContentSize.height >= nextMinimum.height else {
            throw HostRequestExecutionError(
                code: .invalidArgument,
                message: "window size must not be smaller than its minimum size"
            )
        }
        if let title { window.title = title }
        window.minSize = nextMinimum
        if width != nil || height != nil || nextContentSize != currentContentSize {
            window.setContentSize(nextContentSize)
        }
        if let closeBehavior { self.closeBehavior = closeBehavior }
        if let alwaysOnTop { self.alwaysOnTop = alwaysOnTop }
        if let visibleOnAllSpaces { self.visibleOnAllSpaces = visibleOnAllSpaces }
        if let visibleOverFullScreen { self.visibleOverFullScreen = visibleOverFullScreen }
        applyFlags()
        onStateChanged?()
    }

    func state() -> [String: Any] {
        [
            "id": windowID,
            "url": currentURL.absoluteString,
            "title": window?.title ?? "",
            "visible": window?.isVisible == true && window?.isMiniaturized == false,
            "focused": window?.isKeyWindow == true,
            "alwaysOnTop": alwaysOnTop,
            "visibleOnAllSpaces": visibleOnAllSpaces,
            "visibleOverFullScreen": visibleOverFullScreen,
        ]
    }

    private func applyFlags() {
        guard let window else { return }
        window.level = alwaysOnTop ? .floating : .normal
        var behavior = window.collectionBehavior
        behavior.set(.canJoinAllSpaces, enabled: visibleOnAllSpaces)
        behavior.set(.fullScreenAuxiliary, enabled: visibleOverFullScreen)
        window.collectionBehavior = behavior
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closeBehavior == .hide {
            sender.orderOut(nil)
            onStateChanged?()
            return false
        }
        return true
    }

    func windowWillClose(_ notification: Notification) { onClosed?() }
    func windowDidBecomeKey(_ notification: Notification) { onStateChanged?() }
    func windowDidResignKey(_ notification: Notification) { onStateChanged?() }
    func windowDidMiniaturize(_ notification: Notification) { onStateChanged?() }
    func windowDidDeminiaturize(_ notification: Notification) { onStateChanged?() }
    func windowDidMove(_ notification: Notification) { onFrameChanged?() }
    func windowDidResize(_ notification: Notification) { onFrameChanged?() }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        let decision = navigationPolicy.decide(
            url: navigationAction.request.url,
            isMainFrame: navigationAction.targetFrame?.isMainFrame ?? true,
            isUserActivatedLink: navigationAction.navigationType == .linkActivated
        )
        switch decision {
        case .allow: decisionHandler(.allow)
        case .cancel: decisionHandler(.cancel)
        case let .openExternal(url):
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let url = webView.url { currentURL = url }
        onStateChanged?()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    static func constrainedFrame(
        _ frame: DesktopWindowFrame,
        minimumSize: NSSize,
        screens: [NSRect]
    ) -> NSRect? {
        guard frame.isValid, !screens.isEmpty else { return nil }
        let requested = NSRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
        guard let target = screens.max(by: { $0.intersection(requested).area < $1.intersection(requested).area }),
              target.intersection(requested).area > 0 else { return nil }
        let width = min(max(requested.width, minimumSize.width), target.width)
        let height = min(max(requested.height, minimumSize.height), target.height)
        let x = min(max(requested.minX, target.minX), target.maxX - width)
        let y = min(max(requested.minY, target.minY), target.maxY - height)
        return NSRect(x: x, y: y, width: width, height: height)
    }
}

private extension NSWindow.CollectionBehavior {
    mutating func set(_ option: NSWindow.CollectionBehavior, enabled: Bool) {
        if enabled { insert(option) } else { remove(option) }
    }
}

private extension NSRect {
    var area: CGFloat { isNull ? 0 : max(0, width) * max(0, height) }
}
