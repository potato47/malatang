import Foundation

public enum NativeMCPCommand: Equatable, Sendable {
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

public enum NativeMCPErrorCode: String, Codable, Equatable, Sendable {
    case bridgeUnavailable = "BRIDGE_UNAVAILABLE"
    case unauthorized = "UNAUTHORIZED"
    case invalidRequest = "INVALID_REQUEST"
    case unknownCommand = "UNKNOWN_COMMAND"
    case invalidArgument = "INVALID_ARGUMENT"
    case unsafeState = "UNSAFE_STATE"
    case nativeFailure = "NATIVE_FAILURE"
}

public struct NativeMCPCommandError: Error, Equatable, LocalizedError, Sendable {
    public let code: NativeMCPErrorCode
    public let message: String

    public init(code: NativeMCPErrorCode, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}

public enum NativeMCPCommandParser {
    public static func parse(command: String, arguments: [String: Any]) throws -> NativeMCPCommand {
        switch command {
        case "native.getState":
            try requireEmpty(arguments)
            return .getState
        case "app.quit":
            try requireEmpty(arguments)
            return .quit
        case "app.showDock":
            try requireEmpty(arguments)
            return .showDock
        case "app.hideDock":
            try requireEmpty(arguments)
            return .hideDock
        case "window.show":
            try requireEmpty(arguments)
            return .showWindow
        case "window.hide":
            try requireEmpty(arguments)
            return .hideWindow
        case "window.focus":
            try requireEmpty(arguments)
            return .focusWindow
        case "window.setAlwaysOnTop":
            return .setAlwaysOnTop(try boolean(arguments, key: "enabled"))
        case "window.setVisibleOnAllSpaces":
            return .setVisibleOnAllSpaces(try boolean(arguments, key: "enabled"))
        case "window.setVisibleOverFullScreen":
            return .setVisibleOverFullScreen(try boolean(arguments, key: "enabled"))
        case "statusBar.setVisible":
            return .setStatusBarVisible(try boolean(arguments, key: "visible"))
        case "statusBar.setIcon":
            guard Set(arguments.keys) == Set(["symbol"]),
                  let symbol = arguments["symbol"] as? String,
                  !symbol.isEmpty,
                  symbol == symbol.trimmingCharacters(in: .whitespacesAndNewlines),
                  symbol.count <= 128,
                  !symbol.contains("\0")
            else {
                throw NativeMCPCommandError(code: .invalidArgument, message: "symbol must be a valid SF Symbol name")
            }
            return .setStatusBarIcon(symbol)
        default:
            throw NativeMCPCommandError(code: .unknownCommand, message: "Unknown FIA native MCP tool")
        }
    }

    private static func requireEmpty(_ params: [String: Any]) throws {
        guard params.isEmpty else {
            throw NativeMCPCommandError(code: .invalidArgument, message: "Tool does not accept arguments")
        }
    }

    private static func boolean(_ params: [String: Any], key: String) throws -> Bool {
        guard Set(params.keys) == Set([key]), let value = params[key] as? Bool else {
            throw NativeMCPCommandError(code: .invalidArgument, message: "\(key) must be a boolean")
        }
        return value
    }
}
