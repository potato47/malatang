import Foundation

public let FIANativeBridgeVersion = 1
public let FIAMaximumNativeBridgeMessageBytes = 64 * 1024

public enum NativeBridgeCommand: Equatable, Sendable {
    case getState
    case quit
    case showDock
    case hideDock
    case showWindow
    case hideWindow
    case focusWindow
    case setAlwaysOnTop(Bool)
    case setVisibleOnAllSpaces(Bool)
    case setVisibleOverFullScreen(Bool)
    case setStatusBarVisible(Bool)
    case setStatusBarIcon(String)
}

public enum NativeBridgeErrorCode: String, Codable, Equatable, Sendable {
    case bridgeUnavailable = "BRIDGE_UNAVAILABLE"
    case unauthorized = "UNAUTHORIZED"
    case invalidRequest = "INVALID_REQUEST"
    case unknownCommand = "UNKNOWN_COMMAND"
    case invalidArgument = "INVALID_ARGUMENT"
    case unsafeState = "UNSAFE_STATE"
    case nativeFailure = "NATIVE_FAILURE"
}

public struct NativeBridgeProtocolError: Error, Equatable, LocalizedError, Sendable {
    public let code: NativeBridgeErrorCode
    public let message: String

    public init(code: NativeBridgeErrorCode, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}

public enum NativeBridgeProtocol {
    public static func parse(_ body: Any) throws -> NativeBridgeCommand {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              data.count <= FIAMaximumNativeBridgeMessageBytes,
              let root = body as? [String: Any],
              Set(root.keys) == Set(["version", "command", "params"]),
              let version = root["version"] as? Int,
              version == FIANativeBridgeVersion,
              let command = root["command"] as? String,
              let params = root["params"] as? [String: Any]
        else {
            throw NativeBridgeProtocolError(code: .invalidRequest, message: "Invalid FIA native bridge request")
        }

        switch command {
        case "native.getState":
            try requireEmpty(params)
            return .getState
        case "app.quit":
            try requireEmpty(params)
            return .quit
        case "app.showDock":
            try requireEmpty(params)
            return .showDock
        case "app.hideDock":
            try requireEmpty(params)
            return .hideDock
        case "window.show":
            try requireEmpty(params)
            return .showWindow
        case "window.hide":
            try requireEmpty(params)
            return .hideWindow
        case "window.focus":
            try requireEmpty(params)
            return .focusWindow
        case "window.setAlwaysOnTop":
            return .setAlwaysOnTop(try boolean(params, key: "enabled"))
        case "window.setVisibleOnAllSpaces":
            return .setVisibleOnAllSpaces(try boolean(params, key: "enabled"))
        case "window.setVisibleOverFullScreen":
            return .setVisibleOverFullScreen(try boolean(params, key: "enabled"))
        case "statusBar.setVisible":
            return .setStatusBarVisible(try boolean(params, key: "visible"))
        case "statusBar.setIcon":
            guard Set(params.keys) == Set(["symbol"]),
                  let symbol = params["symbol"] as? String,
                  !symbol.isEmpty,
                  symbol == symbol.trimmingCharacters(in: .whitespacesAndNewlines),
                  symbol.count <= 128,
                  !symbol.contains("\0")
            else {
                throw NativeBridgeProtocolError(code: .invalidArgument, message: "symbol must be a valid SF Symbol name")
            }
            return .setStatusBarIcon(symbol)
        default:
            throw NativeBridgeProtocolError(code: .unknownCommand, message: "Unknown FIA native bridge command")
        }
    }

    private static func requireEmpty(_ params: [String: Any]) throws {
        guard params.isEmpty else {
            throw NativeBridgeProtocolError(code: .invalidArgument, message: "Command does not accept parameters")
        }
    }

    private static func boolean(_ params: [String: Any], key: String) throws -> Bool {
        guard Set(params.keys) == Set([key]), let value = params[key] as? Bool else {
            throw NativeBridgeProtocolError(code: .invalidArgument, message: "\(key) must be a boolean")
        }
        return value
    }
}

public struct NativeBridgeOriginPolicy: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let port: Int

    public init?(origin: URL) {
        guard let scheme = origin.scheme?.lowercased(),
              let host = origin.host?.lowercased(),
              let port = origin.port
        else { return nil }
        self.scheme = scheme
        self.host = host
        self.port = port
    }

    public func allows(isMainFrame: Bool, scheme: String, host: String, port: Int) -> Bool {
        isMainFrame
            && self.scheme == scheme.lowercased()
            && self.host == host.lowercased()
            && self.port == port
    }
}
