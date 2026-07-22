import FIAHostCore
import Foundation
import WebKit

final class BundledResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "fia-app"
    static let host = "app"
    private static let noncePlaceholder = "__FIA_CSP_NONCE__"

    private let rootDirectory: URL

    init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            let requestURL = try validatedURL(urlSchemeTask.request.url)
            var data = try Data(contentsOf: requestURL, options: [.mappedIfSafe])
            let contentType = Self.contentType(for: requestURL.pathExtension)
            var headers = [
                "Cache-Control": "no-store",
                "Content-Type": contentType,
                "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff",
            ]
            if contentType.hasPrefix("text/html") {
                let nonce = try RuntimeProtocol.secureToken()
                guard let html = String(data: data, encoding: .utf8) else {
                    throw BundledResourceError.invalidHTML
                }
                data = Data(html.replacingOccurrences(of: Self.noncePlaceholder, with: nonce).utf8)
                headers["Content-Security-Policy"] = [
                    "default-src 'none'",
                    "base-uri 'none'",
                    "object-src 'none'",
                    "frame-ancestors 'none'",
                    "script-src 'nonce-\(nonce)'",
                    "style-src 'nonce-\(nonce)'",
                    "img-src 'self' data: https:",
                    "font-src 'self' data: https:",
                    "connect-src 'self' https: wss:",
                ].joined(separator: "; ")
            }
            guard let response = HTTPURLResponse(
                url: urlSchemeTask.request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            ) else { throw BundledResourceError.invalidResponse }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func validatedURL(_ url: URL?) throws -> URL {
        guard let url,
              url.scheme?.lowercased() == Self.scheme,
              url.host?.lowercased() == Self.host
        else { throw BundledResourceError.invalidURL }
        let relativePath = url.path.removingPercentEncoding ?? url.path
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.isEmpty,
              !components.contains("."),
              !components.contains(".."),
              !components.contains(where: { $0.contains("\0") })
        else { throw BundledResourceError.invalidURL }
        let physicalRoot = rootDirectory.resolvingSymlinksInPath()
        let candidate = components.reduce(rootDirectory) { result, component in
            result.appendingPathComponent(String(component), isDirectory: false)
        }.standardizedFileURL.resolvingSymlinksInPath()
        let rootPath = physicalRoot.path.hasSuffix("/") ? physicalRoot.path : physicalRoot.path + "/"
        guard candidate.path.hasPrefix(rootPath),
              FileManager.default.isReadableFile(atPath: candidate.path)
        else { throw BundledResourceError.notFound }
        return candidate
    }

    private static func contentType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "json", "map": "application/json; charset=utf-8"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "ico": "image/x-icon"
        case "woff": "font/woff"
        case "woff2": "font/woff2"
        default: "application/octet-stream"
        }
    }
}

private enum BundledResourceError: Error {
    case invalidURL
    case notFound
    case invalidHTML
    case invalidResponse
}
