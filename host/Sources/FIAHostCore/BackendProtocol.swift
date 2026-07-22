import Foundation

public let FIABackendProtocolVersion = 1
public let FIABackendMaximumMessageBytes = 1024 * 1024
public let FIABackendMaximumConcurrentRequests = 128

public enum BackendBridgeErrorCode: String, Codable, Equatable, Sendable {
    case backendUnavailable = "BACKEND_UNAVAILABLE"
    case backendRestarted = "BACKEND_RESTARTED"
    case backendTimeout = "BACKEND_TIMEOUT"
    case invalidRequest = "INVALID_REQUEST"
    case protocolError = "PROTOCOL_ERROR"
    case applicationError = "APPLICATION_ERROR"
}

public struct BackendBridgeRequest: Equatable, Sendable {
    public let method: String
    public let input: Data

    public init(method: String, input: Data) {
        self.method = method
        self.input = input
    }
}

public enum BackendBridgeProtocol {
    public static func parse(_ body: Any) throws -> BackendBridgeRequest {
        guard JSONSerialization.isValidJSONObject(body),
              let encoded = try? JSONSerialization.data(withJSONObject: body),
              encoded.count <= FIABackendMaximumMessageBytes,
              let root = body as? [String: Any],
              Set(root.keys) == Set(["version", "method", "input"]),
              root["version"] as? Int == FIABackendProtocolVersion,
              let method = root["method"] as? String,
              validName(method),
              let input = root["input"],
              let inputData = try? JSONSerialization.data(withJSONObject: input, options: [.fragmentsAllowed])
        else {
            throw BackendProtocolError.invalidBridgeRequest
        }
        return BackendBridgeRequest(method: method, input: inputData)
    }

    public static func validName(_ value: String) -> Bool {
        !value.isEmpty
            && value.utf8.count <= 256
            && value.unicodeScalars.allSatisfy { scalar in
                CharacterSet.alphanumerics.contains(scalar) || "._-".unicodeScalars.contains(scalar)
            }
    }
}

public enum BackendProcessMessage: Equatable, Sendable {
    case ready(pid: Int32)
    case success(id: String, value: Data)
    case failure(id: String, code: String, message: String, details: Data?)
    case event(name: String, payload: Data)
}

public enum BackendProcessProtocol {
    public static func encodeInitialize(parentPid: Int32, dataDirectory: String) throws -> Data {
        try encode([
            "protocol": FIABackendProtocolVersion,
            "type": "initialize",
            "parentPid": parentPid,
            "dataDirectory": dataDirectory,
        ])
    }

    public static func encodeRequest(id: String, method: String, input: Data) throws -> Data {
        guard BackendBridgeProtocol.validName(id), BackendBridgeProtocol.validName(method) else {
            throw BackendProtocolError.invalidMessage
        }
        let inputObject = try JSONSerialization.jsonObject(with: input, options: [.fragmentsAllowed])
        return try encode([
            "protocol": FIABackendProtocolVersion,
            "type": "request",
            "id": id,
            "method": method,
            "input": inputObject,
        ])
    }

    public static func encodeShutdown() throws -> Data {
        try encode([
            "protocol": FIABackendProtocolVersion,
            "type": "shutdown",
            "reason": "applicationQuit",
        ])
    }

    public static func decodeLine(_ data: Data, expectedPID: Int32) throws -> BackendProcessMessage {
        guard data.count <= FIABackendMaximumMessageBytes else { throw BackendProtocolError.messageTooLarge }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw BackendProtocolError.invalidJSON
        }
        guard let root = object as? [String: Any],
              root["protocol"] as? Int == FIABackendProtocolVersion,
              let type = root["type"] as? String
        else { throw BackendProtocolError.invalidMessage }

        switch type {
        case "ready":
            guard Set(root.keys) == Set(["protocol", "type", "pid"]),
                  let pid = root["pid"] as? Int,
                  pid == Int(expectedPID)
            else { throw BackendProtocolError.invalidMessage }
            return .ready(pid: expectedPID)
        case "response":
            guard let id = root["id"] as? String, BackendBridgeProtocol.validName(id),
                  let ok = root["ok"] as? Bool
            else { throw BackendProtocolError.invalidMessage }
            if ok {
                guard Set(root.keys) == Set(["protocol", "type", "id", "ok", "value"]),
                      let value = root["value"]
                else { throw BackendProtocolError.invalidMessage }
                return .success(id: id, value: try fragment(value))
            }
            guard Set(root.keys) == Set(["protocol", "type", "id", "ok", "error"]),
                  let error = root["error"] as? [String: Any],
                  Set(error.keys).isSubset(of: Set(["code", "message", "details"])),
                  Set(error.keys).isSuperset(of: Set(["code", "message"])),
                  let code = error["code"] as? String,
                  BackendBridgeProtocol.validName(code),
                  let message = error["message"] as? String,
                  !message.isEmpty,
                  message.utf8.count <= 4096
            else { throw BackendProtocolError.invalidMessage }
            let details = try error["details"].map(fragment)
            return .failure(id: id, code: code, message: message, details: details)
        case "event":
            guard Set(root.keys) == Set(["protocol", "type", "name", "payload"]),
                  let name = root["name"] as? String,
                  BackendBridgeProtocol.validName(name),
                  let payload = root["payload"]
            else { throw BackendProtocolError.invalidMessage }
            return .event(name: name, payload: try fragment(payload))
        default:
            throw BackendProtocolError.invalidMessage
        }
    }

    private static func encode(_ object: [String: Any]) throws -> Data {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0A)
        guard data.count <= FIABackendMaximumMessageBytes else { throw BackendProtocolError.messageTooLarge }
        return data
    }

    private static func fragment(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    }
}

public enum BackendProtocolError: Error, Equatable, LocalizedError, Sendable {
    case invalidBridgeRequest
    case invalidJSON
    case invalidMessage
    case messageTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidBridgeRequest: "Invalid FIA Swift backend bridge request"
        case .invalidJSON: "Swift backend emitted invalid JSON"
        case .invalidMessage: "Swift backend emitted an invalid protocol message"
        case .messageTooLarge: "Swift backend protocol message exceeds 1 MiB"
        }
    }
}
