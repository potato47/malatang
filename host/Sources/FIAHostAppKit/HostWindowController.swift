import AppKit
import FIAHostCore
import WebKit

@MainActor
final class HostWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    private var navigationPolicy: NavigationPolicy?
    private let developmentMode: Bool
    private let closeBehavior: HostConfiguration.Window.CloseBehavior
    private var retryAction: (() -> Void)?
    private var quitAction: (() -> Void)?
    private var bridgeHandler: NativeBridgeHandler?
    private var backendBridgeHandler: BackendBridgeHandler?
    private var bundledResourceHandler: BundledResourceSchemeHandler?
    private weak var webView: WKWebView?
    private let terminateApplication: @MainActor () -> Void

    var onWebFailure: ((String) -> Void)?
    var onWindowStateChanged: (() -> Void)?
    var onWindowFrameChanged: (() -> Void)?

    var isWindowVisible: Bool { window?.isVisible == true && window?.isMiniaturized == false }
    var isWindowFocused: Bool { window?.isKeyWindow == true }
    var currentFrame: DesktopWindowFrame? {
        guard let frame = window?.frame else { return nil }
        return DesktopWindowFrame(
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.size.width,
            height: frame.size.height
        )
    }

    init(
        configuration: HostConfiguration?,
        restoredFrame: DesktopWindowFrame? = nil,
        terminateApplication: @escaping @MainActor () -> Void = { NSApp.terminate(nil) }
    ) {
        developmentMode = configuration?.runtime.isDevelopment ?? false
        closeBehavior = configuration?.window.closeBehavior ?? .quit
        self.terminateApplication = terminateApplication
        let width = configuration?.window.width ?? 900
        let height = configuration?.window.height ?? 620
        let minimumWidth = configuration?.window.minWidth ?? 640
        let minimumHeight = configuration?.window.minHeight ?? 440
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = configuration?.app.name ?? "FIA Prototype"
        window.minSize = NSSize(width: minimumWidth, height: minimumHeight)
        if configuration?.window.restoreState == true,
           let restoredFrame,
           let constrained = Self.constrainedFrame(
            restoredFrame,
            minimumSize: window.minSize,
            screens: NSScreen.screens.map(\.visibleFrame)
           ) {
            window.setFrame(constrained, display: false)
        } else {
            window.center()
        }
        super.init(window: window)
        window.delegate = self
        showLoading("Starting FIA runtime…")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func show() {
        showWindow(nil)
        window?.orderFront(nil)
        onWindowStateChanged?()
    }

    func focus() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        onWindowStateChanged?()
    }

    func hide() {
        window?.orderOut(nil)
        onWindowStateChanged?()
    }

    func showLoading(_ message: String) {
        uninstallBridge()
        retryAction = nil
        quitAction = nil
        navigationPolicy = nil

        let indicator = NSProgressIndicator()
        indicator.style = .spinning
        indicator.controlSize = .regular
        indicator.startAnimation(nil)
        indicator.translatesAutoresizingMaskIntoConstraints = false

        let label = NSTextField(labelWithString: message)
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.textColor = .secondaryLabelColor
        label.translatesAutoresizingMaskIntoConstraints = false

        let view = NSView()
        view.addSubview(indicator)
        view.addSubview(label)
        NSLayoutConstraint.activate([
            indicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            indicator.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -14),
            label.topAnchor.constraint(equalTo: indicator.bottomAnchor, constant: 14),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
        window?.contentView = view
    }

    func showWebView(
        bootstrapURL: URL,
        backendInvoke: ((BackendBridgeRequest) async throws -> Data)? = nil,
        execute: @escaping (NativeBridgeCommand) throws -> DesktopState
    ) {
        installWebView(url: bootstrapURL, schemeHandler: nil, backendInvoke: backendInvoke, execute: execute)
    }

    func showBundledWebView(
        rootDirectory: URL,
        entry: String,
        backendInvoke: ((BackendBridgeRequest) async throws -> Data)? = nil,
        execute: @escaping (NativeBridgeCommand) throws -> DesktopState
    ) {
        let handler = BundledResourceSchemeHandler(rootDirectory: rootDirectory)
        let encodedEntry = entry.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? entry
        guard let url = URL(string: "\(BundledResourceSchemeHandler.scheme)://\(BundledResourceSchemeHandler.host)/\(encodedEntry)") else {
            showFailure(title: "Invalid bundled UI entry", detail: entry, onRetry: nil, onQuit: nil)
            return
        }
        installWebView(url: url, schemeHandler: handler, backendInvoke: backendInvoke, execute: execute)
    }

    private func installWebView(
        url: URL,
        schemeHandler: WKURLSchemeHandler?,
        backendInvoke: ((BackendBridgeRequest) async throws -> Data)?,
        execute: @escaping (NativeBridgeCommand) throws -> DesktopState
    ) {
        uninstallBridge()
        bundledResourceHandler = schemeHandler as? BundledResourceSchemeHandler
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        guard let origin = components?.url,
              let bridgeOrigin = NativeBridgeOriginPolicy(origin: origin)
        else {
            showFailure(title: "Invalid application URL", detail: url.absoluteString, onRetry: nil, onQuit: nil)
            return
        }
        navigationPolicy = NavigationPolicy(origin: origin)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        if let schemeHandler {
            configuration.setURLSchemeHandler(schemeHandler, forURLScheme: BundledResourceSchemeHandler.scheme)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        let handler = NativeBridgeHandler(webView: webView, originPolicy: bridgeOrigin, execute: execute)
        configuration.userContentController.addScriptMessageHandler(
            handler,
            contentWorld: .page,
            name: NativeBridgeHandler.name
        )
        bridgeHandler = handler
        if let backendInvoke {
            let backendHandler = BackendBridgeHandler(
                webView: webView,
                originPolicy: bridgeOrigin,
                invoke: backendInvoke
            )
            configuration.userContentController.addScriptMessageHandler(
                backendHandler,
                contentWorld: .page,
                name: BackendBridgeHandler.name
            )
            backendBridgeHandler = backendHandler
        }
        self.webView = webView
        webView.navigationDelegate = self
        webView.isInspectable = developmentMode
        window?.contentView = webView
        webView.load(URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 10
        ))
    }

    func emitNativeEvent(_ payload: [String: Any]) {
        webView?.callAsyncJavaScript(
            "globalThis.dispatchEvent(new CustomEvent('fia:native-event', { detail: event }))",
            arguments: ["event": payload],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    func emitBackendEvent(name: String, payload: Data) {
        guard let value = try? JSONSerialization.jsonObject(with: payload, options: [.fragmentsAllowed]) else { return }
        webView?.callAsyncJavaScript(
            "globalThis.dispatchEvent(new CustomEvent('fia:backend-event', { detail: { name, payload } }))",
            arguments: ["name": name, "payload": value],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    func showFailure(
        title: String,
        detail: String,
        onRetry: (() -> Void)?,
        onQuit: (() -> Void)?
    ) {
        uninstallBridge()
        retryAction = onRetry
        quitAction = onQuit
        navigationPolicy = nil

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = .systemFont(ofSize: 24, weight: .semibold)
        titleLabel.maximumNumberOfLines = 2

        let detailLabel = NSTextField(wrappingLabelWithString: detail)
        detailLabel.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.maximumNumberOfLines = 12

        let retryButton = NSButton(title: "Retry", target: self, action: #selector(retryPressed))
        retryButton.bezelStyle = .rounded
        retryButton.isHidden = onRetry == nil

        let quitButton = NSButton(title: "Quit", target: self, action: #selector(quitPressed))
        quitButton.bezelStyle = .rounded
        quitButton.isHidden = onQuit == nil

        let buttons = NSStackView(views: [retryButton, quitButton])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [titleLabel, detailLabel, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let view = NSView()
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 36),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -36),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        window?.contentView = view
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        switch closeBehavior {
        case .hide:
            sender.orderOut(nil)
            onWindowStateChanged?()
        case .quit:
            terminateApplication()
        }
        return false
    }

    func windowDidBecomeKey(_ notification: Notification) { onWindowStateChanged?() }
    func windowDidResignKey(_ notification: Notification) { onWindowStateChanged?() }
    func windowDidMiniaturize(_ notification: Notification) { onWindowStateChanged?() }
    func windowDidDeminiaturize(_ notification: Notification) { onWindowStateChanged?() }
    func windowDidMove(_ notification: Notification) { onWindowFrameChanged?() }
    func windowDidResize(_ notification: Notification) { onWindowFrameChanged?() }

    @objc private func retryPressed() { retryAction?() }
    @objc private func quitPressed() { quitAction?() }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let navigationPolicy else {
            decisionHandler(.cancel)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let decision = navigationPolicy.decide(
            url: navigationAction.request.url,
            isMainFrame: isMainFrame,
            isUserActivatedLink: navigationAction.navigationType == .linkActivated
        )
        switch decision {
        case .allow:
            decisionHandler(.allow)
        case .cancel:
            decisionHandler(.cancel)
        case let .openExternal(url):
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onWebFailure?(error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        onWebFailure?(error.localizedDescription)
    }

    private func uninstallBridge() {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: NativeBridgeHandler.name,
            contentWorld: .page
        )
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: BackendBridgeHandler.name,
            contentWorld: .page
        )
        webView?.navigationDelegate = nil
        bridgeHandler = nil
        backendBridgeHandler = nil
        bundledResourceHandler = nil
        webView = nil
    }

    static func constrainedFrame(
        _ frame: DesktopWindowFrame,
        minimumSize: NSSize,
        screens: [NSRect]
    ) -> NSRect? {
        guard frame.isValid, !screens.isEmpty else { return nil }
        let requested = NSRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
        guard let target = screens.max(by: { left, right in
            left.intersection(requested).area < right.intersection(requested).area
        }), target.intersection(requested).area > 0 else { return nil }
        let width = min(max(requested.width, minimumSize.width), target.width)
        let height = min(max(requested.height, minimumSize.height), target.height)
        let x = min(max(requested.minX, target.minX), target.maxX - width)
        let y = min(max(requested.minY, target.minY), target.maxY - height)
        return NSRect(x: x, y: y, width: width, height: height)
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private extension NSRect {
    var area: CGFloat { isNull ? 0 : max(0, width) * max(0, height) }
}
