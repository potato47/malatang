import FIAHostCore
import Foundation
import WebKit

@MainActor
final class BackendBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "fiaBackend"
    static let eventName = "fia:backend-event"

    private weak var webView: WKWebView?
    private let originPolicy: NativeBridgeOriginPolicy
    private let invoke: (BackendBridgeRequest) async throws -> Data

    init(
        webView: WKWebView,
        originPolicy: NativeBridgeOriginPolicy,
        invoke: @escaping (BackendBridgeRequest) async throws -> Data
    ) {
        self.webView = webView
        self.originPolicy = originPolicy
        self.invoke = invoke
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
            replyHandler(Self.failure(code: .invalidRequest, message: "Backend bridge access was denied"), nil)
            return
        }
        let request: BackendBridgeRequest
        do {
            request = try BackendBridgeProtocol.parse(message.body)
        } catch {
            replyHandler(Self.failure(code: .invalidRequest, message: error.localizedDescription), nil)
            return
        }
        Task { @MainActor in
            do {
                let data = try await invoke(request)
                let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
                replyHandler(["ok": true, "value": value], nil)
            } catch let error as BackendInvocationError {
                replyHandler(Self.failure(error), nil)
            } catch {
                replyHandler(Self.failure(code: .backendUnavailable, message: "The backend request failed"), nil)
            }
        }
    }

    private static func failure(_ error: BackendInvocationError) -> [String: Any] {
        var payload: [String: Any] = ["code": error.code.rawValue, "message": error.message]
        if let code = error.applicationCode { payload["applicationCode"] = code }
        if let details = error.details,
           let value = try? JSONSerialization.jsonObject(with: details, options: [.fragmentsAllowed])
        {
            payload["details"] = value
        }
        return ["ok": false, "error": payload]
    }

    private static func failure(code: BackendBridgeErrorCode, message: String) -> [String: Any] {
        ["ok": false, "error": ["code": code.rawValue, "message": message]]
    }
}
