import AppKit
import SwiftUI
import WebKit

public enum WebsiteDataPolicy {
    case ephemeral
    case persistent(UUID)
    case sharedDefault

    @MainActor fileprivate func resolve() -> WKWebsiteDataStore {
        switch self {
        case .ephemeral: .nonPersistent()
        case .persistent(let id): WKWebsiteDataStore(forIdentifier: id)
        case .sharedDefault: .default()
        }
    }
}

/// Owns a WebKit view and its delegates, independently of any NSWindow.
@MainActor
public class WebContent: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    public let webView: WKWebView
    /// Can further restrict navigation, but cannot widen the trusted-content boundary.
    public var navigationPolicy: ((URL) -> Bool)?
    public var onExternalLink: ((URL) -> Void)?
    /// External content only. The application owns the returned view and its UI.
    public var onPopup: ((URLRequest, WKWebViewConfiguration) -> WKWebView?)?
    public var downloadDestination: ((URLResponse, String) -> URL?)?
    public var onDownloadFinished: ((URL) -> Void)?
    public var onError: ((Error) -> Void)?
    private let trustedOrigins: [URL]?
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var destinations: [ObjectIdentifier: URL] = [:]

    init(url: URL, dataStore: WKWebsiteDataStore, trustedOrigins: [URL]?) {
        self.trustedOrigins = trustedOrigins
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        load(url)
    }

    public func load(_ url: URL) {
        guard allows(url) else {
            onExternalLink?(url)
            return
        }
        webView.load(URLRequest(url: url))
    }

    func allows(_ url: URL) -> Bool {
        let scheme = url.scheme?.lowercased()
        let allowed: Bool
        if let trustedOrigins {
            allowed = trustedOrigins.contains { Self.sameOrigin(url, $0) }
        } else {
            allowed = scheme == "http" || scheme == "https" || url.absoluteString == "about:blank"
        }
        return allowed && (navigationPolicy?(url) ?? true)
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        return ["http", "https"].contains(lhs.scheme?.lowercased() ?? "")
            && lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && port(lhs) == port(rhs) && lhs.user == nil && lhs.password == nil
    }

    public func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url, allows(url) else {
            if let url = navigationAction.request.url { onExternalLink?(url) }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(
            navigationAction.shouldPerformDownload ? (downloadDestination == nil ? .cancel : .download) : .allow)
    }

    public func webView(
        _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
    ) {
        guard let url = navigationResponse.response.url, allows(url) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(
            navigationResponse.canShowMIMEType ? .allow : (downloadDestination == nil ? .cancel : .download))
    }

    public func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        makePopup(request: navigationAction.request, configuration: configuration)
    }

    func makePopup(request: URLRequest, configuration: WKWebViewConfiguration) -> WKWebView? {
        guard trustedOrigins == nil else {
            if let url = request.url { onExternalLink?(url) }
            return nil
        }
        guard let url = request.url, allows(url) else { return nil }
        return onPopup?(request, configuration)
    }

    func destination(response: URLResponse, filename: String) -> URL? {
        guard let url = downloadDestination?(response, filename), url.isFileURL else { return nil }
        return url
    }

    public func download(
        _ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        decisionHandler: @escaping @MainActor (WKDownload.RedirectPolicy) -> Void
    ) {
        decisionHandler(request.url.map(allows) == true ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        track(download)
    }
    public func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload)
    { track(download) }
    private func track(_ download: WKDownload) {
        downloads[ObjectIdentifier(download)] = download
        download.delegate = self
    }
    public func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
        completionHandler: @escaping @MainActor (URL?) -> Void
    ) {
        let destination = destination(response: response, filename: suggestedFilename)
        if let destination, destination.isFileURL {
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } else {
            completionHandler(nil)
            downloads.removeValue(forKey: ObjectIdentifier(download))
        }
    }
    public func downloadDidFinish(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        downloads.removeValue(forKey: id)
        if let destination = destinations.removeValue(forKey: id) { onDownloadFinished?(destination) }
    }
    public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        destinations.removeValue(forKey: ObjectIdentifier(download))
        onError?(error)
    }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onError?(error)
    }
    public func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
    ) { onError?(error) }
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onError?(ManagedProcessError("Web content process terminated"))
    }
}

@MainActor
public final class ExternalWebContent: WebContent {
    public init(url: URL, dataStore: WebsiteDataPolicy = .ephemeral) {
        super.init(url: url, dataStore: dataStore.resolve(), trustedOrigins: nil)
    }
}

@MainActor
public final class FIAWebContent: WebContent {
    init(url: URL, trustedOrigins: [URL]) {
        super.init(url: url, dataStore: .nonPersistent(), trustedOrigins: trustedOrigins)
    }
}

/// Keep the content object alive in application state to preserve navigation and input.
public struct WebContentView: NSViewRepresentable {
    public let content: WebContent
    public init(_ content: WebContent) { self.content = content }
    public func makeNSView(context: Context) -> WKWebView { content.webView }
    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}
