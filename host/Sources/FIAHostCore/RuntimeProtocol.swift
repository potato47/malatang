import Foundation
import Security

public let FIARuntimeProtocolVersion = 1
public let FIAMaximumControlLineBytes = 16 * 1024

public struct InitializeMessage: Encodable, Equatable, Sendable {
    public let protocolVersion: Int
    public let type: String
    public let bootstrapToken: String
    public let controlToken: String
    public let parentPid: Int32
    public let dataDirectory: String

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case type
        case bootstrapToken
        case controlToken
        case parentPid
        case dataDirectory
    }

    public init(bootstrapToken: String, controlToken: String, parentPid: Int32, dataDirectory: String) {
        self.protocolVersion = FIARuntimeProtocolVersion
        self.type = "initialize"
        self.bootstrapToken = bootstrapToken
        self.controlToken = controlToken
        self.parentPid = parentPid
        self.dataDirectory = dataDirectory
    }
}

public struct ShutdownMessage: Encodable, Equatable, Sendable {
    public let protocolVersion = FIARuntimeProtocolVersion
    public let type = "shutdown"
    public let reason = "applicationQuit"

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case type
        case reason
    }

    public init() {}
}

public struct ReadyMessage: Decodable, Equatable, Sendable {
    public let protocolVersion: Int
    public let type: String
    public let port: Int
    public let pid: Int32

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case type
        case port
        case pid
    }
}

public enum RuntimeProtocolError: Error, Equatable, LocalizedError, Sendable {
    case randomGenerationFailed(OSStatus)
    case messageTooLarge
    case invalidUTF8
    case invalidJSON
    case unknownOrMissingFields
    case unsupportedProtocol(Int)
    case unexpectedType(String)
    case invalidPort(Int)
    case unexpectedPID(expected: Int32, actual: Int32)

    public var errorDescription: String? {
        switch self {
        case let .randomGenerationFailed(status): "Secure random generation failed (\(status))"
        case .messageTooLarge: "Runtime protocol message exceeds 16 KiB"
        case .invalidUTF8: "Runtime protocol message is not UTF-8"
        case .invalidJSON: "Runtime protocol message is not valid JSON"
        case .unknownOrMissingFields: "Runtime protocol message has unknown or missing fields"
        case let .unsupportedProtocol(version): "Runtime protocol \(version) is unsupported"
        case let .unexpectedType(type): "Unexpected runtime message type \(type)"
        case let .invalidPort(port): "Runtime returned invalid port \(port)"
        case let .unexpectedPID(expected, actual): "Runtime PID mismatch (expected \(expected), got \(actual))"
        }
    }
}

public enum RuntimeProtocol {
    public static func secureToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw RuntimeProtocolError.randomGenerationFailed(status) }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func encodeLine<T: Encodable>(_ message: T) throws -> Data {
        var data = try JSONEncoder().encode(message)
        data.append(0x0A)
        guard data.count <= FIAMaximumControlLineBytes else { throw RuntimeProtocolError.messageTooLarge }
        return data
    }

    public static func decodeReadyLine(_ data: Data, expectedPID: Int32) throws -> ReadyMessage {
        guard data.count <= FIAMaximumControlLineBytes else { throw RuntimeProtocolError.messageTooLarge }
        guard String(data: data, encoding: .utf8) != nil else { throw RuntimeProtocolError.invalidUTF8 }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw RuntimeProtocolError.invalidJSON
        }
        guard let dictionary = object as? [String: Any],
              Set(dictionary.keys) == Set(["protocol", "type", "port", "pid"])
        else { throw RuntimeProtocolError.unknownOrMissingFields }

        let ready: ReadyMessage
        do {
            ready = try JSONDecoder().decode(ReadyMessage.self, from: data)
        } catch {
            throw RuntimeProtocolError.invalidJSON
        }
        guard ready.protocolVersion == FIARuntimeProtocolVersion else {
            throw RuntimeProtocolError.unsupportedProtocol(ready.protocolVersion)
        }
        guard ready.type == "ready" else { throw RuntimeProtocolError.unexpectedType(ready.type) }
        guard (1...65_535).contains(ready.port) else { throw RuntimeProtocolError.invalidPort(ready.port) }
        guard ready.pid == expectedPID else {
            throw RuntimeProtocolError.unexpectedPID(expected: expectedPID, actual: ready.pid)
        }
        return ready
    }
}

