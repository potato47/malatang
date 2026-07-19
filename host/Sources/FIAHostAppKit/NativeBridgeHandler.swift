import FIAHostCore
import Foundation
import WebKit

struct NativeCommandExecutionError: Error, LocalizedError {
    let code: NativeBridgeErrorCode
    let message: String

    var errorDescription: String? { message }
}

@MainActor
final class NativeBridgeHandler: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "fiaNative"
    static let eventName = "fia:native-event"

    private weak var webView: WKWebView?
    private let originPolicy: NativeBridgeOriginPolicy
    private let execute: (NativeBridgeCommand) throws -> DesktopState

    init(
        webView: WKWebView,
        originPolicy: NativeBridgeOriginPolicy,
        execute: @escaping (NativeBridgeCommand) throws -> DesktopState
    ) {
        self.webView = webView
        self.originPolicy = originPolicy
        self.execute = execute
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
            replyHandler(Self.failure(code: .unauthorized, message: "Native bridge access was denied"), nil)
            return
        }

        do {
            let command = try NativeBridgeProtocol.parse(message.body)
            let state = try execute(command)
            replyHandler(["ok": true, "value": try Self.jsonObject(state)], nil)
        } catch let error as NativeBridgeProtocolError {
            replyHandler(Self.failure(code: error.code, message: error.message), nil)
        } catch let error as NativeCommandExecutionError {
            replyHandler(Self.failure(code: error.code, message: error.message), nil)
        } catch let error as DesktopStateError {
            replyHandler(Self.failure(code: .unsafeState, message: error.localizedDescription), nil)
        } catch {
            replyHandler(Self.failure(code: .nativeFailure, message: "The native command failed"), nil)
        }
    }

    static func stateChangedEvent(_ state: DesktopState) throws -> [String: Any] {
        ["type": "stateChanged", "state": try jsonObject(state)]
    }

    static var statusBarClickedEvent: [String: Any] {
        ["type": "statusBarClicked", "button": "left"]
    }

    private static func failure(code: NativeBridgeErrorCode, message: String) -> [String: Any] {
        ["ok": false, "error": ["code": code.rawValue, "message": message]]
    }

    private static func jsonObject<Value: Encodable>(_ value: Value) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
}
