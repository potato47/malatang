import AppKit
import FIAHostCore
import WebKit

enum HostWindowStyle: String, Sendable {
    case native
    case borderless
}

struct HostWindowDragRegion: Equatable, Sendable {
    let height: Double
    let leftInset: Double
    let rightInset: Double

    var state: [String: Any] {
        ["height": height, "leftInset": leftInset, "rightInset": rightInset]
    }
}

@MainActor
final class FIAHostWindow: NSWindow {
    private let acceptsKeyAndMain: Bool
    let dragRegion: HostWindowDragRegion?
    var onDragEnded: (() -> Void)?

    init(
        contentRect: NSRect,
        styleMask: NSWindow.StyleMask,
        acceptsKeyAndMain: Bool,
        dragRegion: HostWindowDragRegion?
    ) {
        self.acceptsKeyAndMain = acceptsKeyAndMain
        self.dragRegion = dragRegion
        super.init(contentRect: contentRect, styleMask: styleMask, backing: .buffered, defer: false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override var canBecomeKey: Bool { acceptsKeyAndMain || super.canBecomeKey }
    override var canBecomeMain: Bool { acceptsKeyAndMain || super.canBecomeMain }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown,
           let dragRegion,
           let contentView,
           Self.containsDragPoint(
            contentView.convert(event.locationInWindow, from: nil),
            bounds: contentView.bounds,
            flipped: contentView.isFlipped,
            region: dragRegion
           ) {
            performDrag(with: event)
            onDragEnded?()
            return
        }
        super.sendEvent(event)
    }

    static func containsDragPoint(
        _ point: NSPoint,
        bounds: NSRect,
        flipped: Bool,
        region: HostWindowDragRegion
    ) -> Bool {
        let minimumX = bounds.minX + region.leftInset
        let maximumX = bounds.maxX - region.rightInset
        guard minimumX < maximumX, point.x >= minimumX, point.x <= maximumX else { return false }
        let clippedHeight = min(region.height, bounds.height)
        if flipped {
            return point.y >= bounds.minY && point.y <= bounds.minY + clippedHeight
        }
        return point.y >= bounds.maxY - clippedHeight && point.y <= bounds.maxY
    }
}

@MainActor
final class HostWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    enum CloseBehavior { case hide, close }

    let windowID: String
    let windowStyle: HostWindowStyle
    let transparent: Bool
    let shadow: Bool
    let resizable: Bool
    let dragRegion: HostWindowDragRegion?

    private var closeBehavior: CloseBehavior
    private let webView: WKWebView
    private var navigationPolicy: NavigationPolicy
    private var currentURL: URL
    private var alwaysOnTop: Bool
    private var visibleOnAllSpaces: Bool
    private var visibleOverFullScreen: Bool
    private var lastKnownFrame: DesktopWindowFrame?
    private var pendingFrameStateTask: Task<Void, Never>?

    var onStateChanged: (() -> Void)?
    var onFrameChanged: (() -> Void)?
    var onClosed: (() -> Void)?

    var currentFrame: DesktopWindowFrame? {
        if let frame = window?.frame { return Self.desktopFrame(frame) }
        return lastKnownFrame
    }

    init(
        id: String,
        url: URL,
        title: String,
        width: Double,
        height: Double,
        minWidth: Double,
        minHeight: Double,
        x: Double? = nil,
        y: Double? = nil,
        restoredFrame: DesktopWindowFrame?,
        dataStore: WKWebsiteDataStore,
        closeBehavior: CloseBehavior,
        windowStyle: HostWindowStyle = .native,
        transparent: Bool = false,
        shadow: Bool = true,
        resizable: Bool = true,
        dragRegion: HostWindowDragRegion? = nil,
        alwaysOnTop: Bool,
        visibleOnAllSpaces: Bool,
        visibleOverFullScreen: Bool,
        inspectable: Bool
    ) {
        windowID = id
        currentURL = url
        navigationPolicy = NavigationPolicy(origin: url)
        self.closeBehavior = closeBehavior
        self.windowStyle = windowStyle
        self.transparent = transparent
        self.shadow = shadow
        self.resizable = resizable
        self.dragRegion = dragRegion
        self.alwaysOnTop = alwaysOnTop
        self.visibleOnAllSpaces = visibleOnAllSpaces
        self.visibleOverFullScreen = visibleOverFullScreen

        var styleMask: NSWindow.StyleMask = windowStyle == .native
            ? [.titled, .closable, .miniaturizable]
            : [.borderless]
        if resizable { styleMask.insert(.resizable) }
        let window = FIAHostWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: styleMask,
            acceptsKeyAndMain: windowStyle == .borderless,
            dragRegion: dragRegion
        )
        window.title = title
        window.minSize = NSSize(width: minWidth, height: minHeight)
        window.hasShadow = shadow
        if transparent {
            window.isOpaque = false
            window.backgroundColor = .clear
        }
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
        if let primaryScreen = NSScreen.screens.first?.frame, x != nil || y != nil {
            window.setFrame(
                Self.positionedFrame(window.frame, x: x, y: y, primaryScreen: primaryScreen),
                display: false
            )
        }
        lastKnownFrame = Self.desktopFrame(window.frame)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = inspectable
        if transparent {
            webView.underPageBackgroundColor = .clear
            webView.setValue(false, forKey: "drawsBackground")
        }
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        window.onDragEnded = { [weak self] in self?.emitFrameStateChanged() }
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

    func validateCreationOptions(
        windowStyle: HostWindowStyle?,
        transparent: Bool?,
        shadow: Bool?,
        resizable: Bool?,
        dragRegion: HostWindowDragRegion?
    ) throws {
        let mismatched =
            (windowStyle != nil && windowStyle != self.windowStyle) ||
            (transparent != nil && transparent != self.transparent) ||
            (shadow != nil && shadow != self.shadow) ||
            (resizable != nil && resizable != self.resizable) ||
            (dragRegion != nil && dragRegion != self.dragRegion)
        guard !mismatched else {
            throw HostRequestExecutionError(
                code: .invalidArgument,
                message: "windowStyle, transparent, shadow, resizable, and dragRegion are creation-only"
            )
        }
    }

    func update(
        title: String?,
        width: Double? = nil,
        height: Double? = nil,
        minWidth: Double? = nil,
        minHeight: Double? = nil,
        x: Double? = nil,
        y: Double? = nil,
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
        if let primaryScreen = NSScreen.screens.first?.frame, x != nil || y != nil {
            window.setFrame(
                Self.positionedFrame(window.frame, x: x, y: y, primaryScreen: primaryScreen),
                display: true
            )
        }
        if let closeBehavior { self.closeBehavior = closeBehavior }
        if let alwaysOnTop { self.alwaysOnTop = alwaysOnTop }
        if let visibleOnAllSpaces { self.visibleOnAllSpaces = visibleOnAllSpaces }
        if let visibleOverFullScreen { self.visibleOverFullScreen = visibleOverFullScreen }
        recordFrame()
        applyFlags()
        if width != nil || height != nil || minWidth != nil || minHeight != nil || x != nil || y != nil {
            scheduleFrameStateChanged()
        } else {
            onStateChanged?()
        }
    }

    func state() -> [String: Any] {
        let nativeFrame = window?.frame ?? currentFrame.map(Self.nativeRect) ?? .zero
        let primaryScreen = NSScreen.screens.first?.frame ?? .zero
        let frame = Self.publicFrame(nativeFrame, primaryScreen: primaryScreen)
        return [
            "id": windowID,
            "url": currentURL.absoluteString,
            "title": window?.title ?? "",
            "visible": window?.isVisible == true && window?.isMiniaturized == false,
            "focused": window?.isKeyWindow == true,
            "windowStyle": windowStyle.rawValue,
            "transparent": transparent,
            "shadow": shadow,
            "resizable": resizable,
            "dragRegion": dragRegion?.state ?? NSNull(),
            "frame": [
                "x": Double(frame.origin.x),
                "y": Double(frame.origin.y),
                "width": Double(frame.width),
                "height": Double(frame.height),
            ],
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

    private func recordFrame() {
        guard let frame = window?.frame else { return }
        lastKnownFrame = Self.desktopFrame(frame)
        onFrameChanged?()
    }

    private func scheduleFrameStateChanged() {
        pendingFrameStateTask?.cancel()
        pendingFrameStateTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled, let self else { return }
            self.pendingFrameStateTask = nil
            self.onStateChanged?()
        }
    }

    private func emitFrameStateChanged() {
        pendingFrameStateTask?.cancel()
        pendingFrameStateTask = nil
        onStateChanged?()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closeBehavior == .hide {
            sender.orderOut(nil)
            onStateChanged?()
            return false
        }
        return true
    }

    func windowWillClose(_ notification: Notification) {
        pendingFrameStateTask?.cancel()
        pendingFrameStateTask = nil
        onClosed?()
    }
    func windowDidBecomeKey(_ notification: Notification) { onStateChanged?() }
    func windowDidResignKey(_ notification: Notification) { onStateChanged?() }
    func windowDidMiniaturize(_ notification: Notification) { onStateChanged?() }
    func windowDidDeminiaturize(_ notification: Notification) { onStateChanged?() }
    func windowDidMove(_ notification: Notification) { recordFrame(); scheduleFrameStateChanged() }
    func windowDidResize(_ notification: Notification) { recordFrame(); scheduleFrameStateChanged() }
    func windowDidEndLiveResize(_ notification: Notification) { emitFrameStateChanged() }

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

    static func positionedFrame(
        _ frame: NSRect,
        x: Double?,
        y: Double?,
        primaryScreen: NSRect
    ) -> NSRect {
        var positioned = frame
        if let x { positioned.origin.x = primaryScreen.minX + x }
        if let y { positioned.origin.y = primaryScreen.maxY - y - frame.height }
        return positioned
    }

    static func publicFrame(_ frame: NSRect, primaryScreen: NSRect) -> NSRect {
        NSRect(
            x: frame.minX - primaryScreen.minX,
            y: primaryScreen.maxY - frame.maxY,
            width: frame.width,
            height: frame.height
        )
    }

    static func constrainedFrame(
        _ frame: DesktopWindowFrame,
        minimumSize: NSSize,
        screens: [NSRect]
    ) -> NSRect? {
        guard frame.isValid, !screens.isEmpty else { return nil }
        let requested = nativeRect(frame)
        guard let target = screens.max(by: { $0.intersection(requested).area < $1.intersection(requested).area }),
              target.intersection(requested).area > 0 else { return nil }
        let width = min(max(requested.width, minimumSize.width), target.width)
        let height = min(max(requested.height, minimumSize.height), target.height)
        let x = min(max(requested.minX, target.minX), target.maxX - width)
        let y = min(max(requested.minY, target.minY), target.maxY - height)
        return NSRect(x: x, y: y, width: width, height: height)
    }

    private static func desktopFrame(_ frame: NSRect) -> DesktopWindowFrame {
        DesktopWindowFrame(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height)
    }

    private static func nativeRect(_ frame: DesktopWindowFrame) -> NSRect {
        NSRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
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
