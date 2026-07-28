import FIAHostCore
import Foundation
import WebKit

@MainActor
final class MCPBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "fiaMcp"

    private weak var webView: WKWebView?
    private let originPolicy: MCPBridgeOriginPolicy
    private let route: (MCPBridgeEnvelope) throws -> Void

    init(
        webView: WKWebView,
        originPolicy: MCPBridgeOriginPolicy,
        route: @escaping (MCPBridgeEnvelope) throws -> Void
    ) {
        self.webView = webView
        self.originPolicy = originPolicy
        self.route = route
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard message.webView === webView,
              originPolicy.allows(
                isMainFrame: message.frameInfo.isMainFrame,
                scheme: message.frameInfo.securityOrigin.protocol,
                host: message.frameInfo.securityOrigin.host,
                port: message.frameInfo.securityOrigin.port
              )
        else {
            replyHandler(Self.failure("MCP bridge access was denied"), nil)
            return
        }
        do {
            try route(MCPBridgeProtocol.parse(message.body))
            replyHandler(["ok": true], nil)
        } catch {
            replyHandler(Self.failure(error.localizedDescription), nil)
        }
    }

    private static func failure(_ message: String) -> [String: Any] {
        ["ok": false, "error": ["message": message]]
    }
}
