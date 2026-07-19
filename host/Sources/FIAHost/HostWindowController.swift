import AppKit
import FIAHostCore
import WebKit

@MainActor
final class HostWindowController: NSWindowController, WKNavigationDelegate {
    private var navigationPolicy: NavigationPolicy?
    private let developmentMode: Bool
    private var retryAction: (() -> Void)?
    private var quitAction: (() -> Void)?
    var onWebFailure: ((String) -> Void)?

    init(configuration: HostConfiguration?) {
        developmentMode = configuration?.runtime.isDevelopment ?? false
        let width = configuration?.window.width ?? 900
        let height = configuration?.window.height ?? 620
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = configuration?.app.name ?? "FIA Prototype"
        window.minSize = NSSize(
            width: configuration?.window.minWidth ?? 640,
            height: configuration?.window.minHeight ?? 440
        )
        window.center()
        super.init(window: window)
        showLoading("Starting FIA runtime…")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func showLoading(_ message: String) {
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

    func showWebView(bootstrapURL: URL) {
        guard let origin = URL(string: "\(bootstrapURL.scheme!)://\(bootstrapURL.host!):\(bootstrapURL.port!)") else {
            showFailure(title: "Invalid runtime URL", detail: bootstrapURL.absoluteString, onRetry: nil, onQuit: nil)
            return
        }
        navigationPolicy = NavigationPolicy(origin: origin)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isInspectable = developmentMode
        window?.contentView = webView
        webView.load(URLRequest(
            url: bootstrapURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 10
        ))
    }

    func showFailure(
        title: String,
        detail: String,
        onRetry: (() -> Void)?,
        onQuit: (() -> Void)?
    ) {
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

        let retryButton = NSButton(title: "Restart Runtime", target: self, action: #selector(retryPressed))
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
}
