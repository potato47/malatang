import Foundation

public let FIAStdioProtocolVersion = 5
public let FIAMaximumStdioFrameBytes = 1024 * 1024
public let FIAMaximumPendingRequests = 128

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
