import Foundation

public struct BackendStdoutDecoder: Sendable {
    private var buffer = Data()

    public init() {}

    public mutating func append(_ data: Data) throws -> [[String: Any]] {
        buffer.append(data)
        var frames: [[String: Any]] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard !line.isEmpty, line.count <= FIAMaximumStdioFrameBytes else {
                throw BackendProtocolError.invalidFrame
            }
            let object: Any
            do {
                object = try JSONSerialization.jsonObject(with: Data(line))
            } catch {
                throw BackendProtocolError.invalidJSON
            }
            guard let frame = object as? [String: Any], frame["v"] as? Int == FIAStdioProtocolVersion,
                  frame["type"] is String else { throw BackendProtocolError.invalidFrame }
            frames.append(frame)
        }
        guard buffer.count <= FIAMaximumStdioFrameBytes else { throw BackendProtocolError.frameTooLarge }
        return frames
    }

    public mutating func reset() {
        buffer.removeAll(keepingCapacity: false)
    }
}

public enum BackendProtocolError: Error, Equatable, Sendable {
    case invalidJSON
    case invalidFrame
    case frameTooLarge
}

public enum HostRequestErrorCode: String, Sendable {
    case invalidRequest = "INVALID_REQUEST"
    case invalidArgument = "INVALID_ARGUMENT"
    case notFound = "NOT_FOUND"
    case unsafeState = "UNSAFE_STATE"
    case nativeFailure = "NATIVE_FAILURE"
    case protocolFailure = "PROTOCOL_FAILURE"
    case timeout = "TIMEOUT"
    case cancelled = "CANCELLED"
    case conflict = "CONFLICT"
    case permissionDenied = "PERMISSION_DENIED"
}

public struct HostRequestExecutionError: Error, LocalizedError, Sendable {
    public let code: HostRequestErrorCode
    public let message: String

    public init(code: HostRequestErrorCode, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}
