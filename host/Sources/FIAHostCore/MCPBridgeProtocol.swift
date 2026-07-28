import Foundation

public let FIAMaximumMCPMessageBytes = 1024 * 1024
public let FIAMaximumMCPConcurrentMessages = 128
public let FIAMCPCallTimeout: TimeInterval = 30
public let FIAMCPDiscoveryTimeout: TimeInterval = 10

public struct MCPBridgeEnvelope {
    public let serverID: String
    public let message: [String: Any]
    public let data: Data

    public init(serverID: String, message: [String: Any], data: Data) {
        self.serverID = serverID
        self.message = message
        self.data = data
    }
}

public enum MCPBridgeProtocolError: Error, Equatable, LocalizedError, Sendable {
    case invalidEnvelope
    case invalidServerID
    case invalidMessage
    case messageTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidEnvelope: "Invalid FIA MCP bridge envelope"
        case .invalidServerID: "Invalid FIA MCP server ID"
        case .invalidMessage: "Invalid MCP JSON-RPC message"
        case .messageTooLarge: "MCP message exceeds the 1 MiB limit"
        }
    }
}

public enum MCPBridgeProtocol {
    public static func parse(_ body: Any) throws -> MCPBridgeEnvelope {
        guard JSONSerialization.isValidJSONObject(body),
              let envelopeData = try? JSONSerialization.data(withJSONObject: body),
              envelopeData.count <= FIAMaximumMCPMessageBytes,
              let root = body as? [String: Any],
              Set(root.keys) == Set(["bridgeVersion", "serverId", "message"]),
              root["bridgeVersion"] as? Int == FIAMCPBridgeVersion,
              let serverID = root["serverId"] as? String,
              let message = root["message"] as? [String: Any]
        else {
            if let data = try? JSONSerialization.data(withJSONObject: body),
               data.count > FIAMaximumMCPMessageBytes {
                throw MCPBridgeProtocolError.messageTooLarge
            }
            throw MCPBridgeProtocolError.invalidEnvelope
        }
        guard validServerID(serverID) else { throw MCPBridgeProtocolError.invalidServerID }
        guard message["jsonrpc"] as? String == "2.0" else {
            throw MCPBridgeProtocolError.invalidMessage
        }
        guard let method = message["method"] as? String,
              !method.isEmpty,
              message["result"] == nil,
              message["error"] == nil
        else { throw MCPBridgeProtocolError.invalidMessage }
        if let id = message["id"], !(id is String) && !(id is Int) && !(id is Double) {
            throw MCPBridgeProtocolError.invalidMessage
        }
        let data = try JSONSerialization.data(withJSONObject: message)
        guard data.count <= FIAMaximumMCPMessageBytes else {
            throw MCPBridgeProtocolError.messageTooLarge
        }
        return MCPBridgeEnvelope(serverID: serverID, message: message, data: data)
    }

    public static func validServerID(_ id: String) -> Bool {
        if id == "app" || id == "fia.native" { return true }
        guard !id.hasPrefix("fia."), !id.contains("..") else { return false }
        return id.range(
            of: #"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$"#,
            options: .regularExpression
        ) != nil
    }
}

public struct MCPBridgeOriginPolicy: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let port: Int

    public init?(origin: URL) {
        guard let scheme = origin.scheme?.lowercased(),
              let host = origin.host?.lowercased()
        else { return nil }
        self.scheme = scheme
        self.host = host
        self.port = origin.port ?? Self.defaultPort(for: scheme)
    }

    public func allows(isMainFrame: Bool, scheme: String, host: String, port: Int) -> Bool {
        isMainFrame
            && self.scheme == scheme.lowercased()
            && self.host == host.lowercased()
            && self.port == port
    }

    private static func defaultPort(for scheme: String) -> Int {
        switch scheme {
        case "http": 80
        case "https": 443
        default: 0
        }
    }
}
