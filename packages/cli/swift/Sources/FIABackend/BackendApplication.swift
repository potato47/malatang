import Darwin
import Foundation

public let FIABackendProtocolVersion = 1
public let FIABackendMaximumMessageBytes = 1024 * 1024
public let FIABackendMaximumConcurrentRequests = 128

public struct BackendApplicationError: Error, Sendable {
    public let code: String
    public let message: String
    public let details: JSONValue?

    public init(code: String, message: String, details: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

public struct BackendLogger: Sendable {
    public init() {}

    public func info(_ message: String) { write("info", message) }
    public func warning(_ message: String) { write("warning", message) }
    public func error(_ message: String) { write("error", message) }

    private func write(_ level: String, _ message: String) {
        let entry = BackendLogEntry(
            source: "fia-backend",
            level: level,
            message: String(message.prefix(4096))
        )
        guard var data = try? JSONEncoder().encode(entry) else { return }
        data.append(0x0A)
        try? FileHandle.standardError.write(contentsOf: data)
    }
}

private struct BackendLogEntry: Encodable {
    let source: String
    let level: String
    let message: String
}

public struct BackendContext: Sendable {
    public let dataDirectory: URL
    public let requestID: String
    public let logger = BackendLogger()
    private let writer: ProtocolWriter

    init(dataDirectory: URL, requestID: String, writer: ProtocolWriter) {
        self.dataDirectory = dataDirectory
        self.requestID = requestID
        self.writer = writer
    }

    public var isCancelled: Bool { Task.isCancelled }

    public func emit<Payload: Encodable & Sendable>(name: String, payload: Payload) async throws {
        guard BackendProtocol.validName(name) else {
            throw BackendApplicationError(code: "INVALID_EVENT", message: "Event name is invalid")
        }
        try await writer.event(name: name, payload: JSONValue.encode(payload))
    }
}

private protocol RouteBox: Sendable {
    func invoke(input: JSONValue, context: BackendContext) async throws -> JSONValue
}

private struct TypedRoute<Input: Decodable & Sendable, Output: Encodable & Sendable>: RouteBox {
    let handler: @Sendable (Input, BackendContext) async throws -> Output

    func invoke(input: JSONValue, context: BackendContext) async throws -> JSONValue {
        let decoded: Input
        do {
            decoded = try input.decode(Input.self)
        } catch {
            throw BackendApplicationError(code: "INVALID_INPUT", message: "Backend request input is invalid")
        }
        return try JSONValue.encode(await handler(decoded, context))
    }
}

public final class BackendApplication: @unchecked Sendable {
    private let lock = NSLock()
    private var routes: [String: any RouteBox] = [:]
    private var running = false

    public init() {}

    public func handle<Input: Decodable & Sendable, Output: Encodable & Sendable>(
        _ method: String,
        input: Input.Type,
        output: Output.Type,
        handler: @escaping @Sendable (Input, BackendContext) async throws -> Output
    ) {
        precondition(BackendProtocol.validName(method), "Backend method name is invalid")
        lock.lock()
        defer { lock.unlock() }
        precondition(!running, "Backend routes cannot change after run()")
        precondition(routes[method] == nil, "Backend method is already registered: \(method)")
        routes[method] = TypedRoute(handler: handler)
    }

    public func run() async throws {
        try await run(input: .standardInput, output: .standardOutput)
    }

    func run(input: FileHandle, output: FileHandle) async throws {
        let routes = lock.withLock {
            precondition(!running, "BackendApplication.run() may only be called once")
            running = true
            return self.routes
        }

        let reader = ProtocolLineReader(input: input)
        let firstLine = try reader.readLine()
        guard let firstLine else { return }
        let initialize = try BackendProtocol.initialize(firstLine)
        let writer = ProtocolWriter(output: output)
        let registry = RequestRegistry()
        try await writer.ready(pid: getpid())

        while let line = try reader.readLine() {
            let message: BackendInboundMessage
            do {
                message = try BackendProtocol.inbound(line)
            } catch {
                BackendLogger().error("invalid Host protocol message")
                await registry.cancelAll()
                throw error
            }
            switch message {
            case .shutdown:
                await registry.cancelAll()
                return
            case let .request(id, method, input):
                guard await registry.reserve(id, maximum: FIABackendMaximumConcurrentRequests) else {
                    try await writer.failure(
                        id: id,
                        error: BackendApplicationError(code: "TOO_MANY_REQUESTS", message: "Too many requests")
                    )
                    continue
                }
                let task = Task {
                    defer { Task { await registry.remove(id) } }
                    guard let route = routes[method] else {
                        try? await writer.failure(
                            id: id,
                            error: BackendApplicationError(code: "METHOD_NOT_FOUND", message: "Unknown backend method")
                        )
                        return
                    }
                    let context = BackendContext(
                        dataDirectory: URL(fileURLWithPath: initialize.dataDirectory, isDirectory: true),
                        requestID: id,
                        writer: writer
                    )
                    do {
                        let value = try await route.invoke(input: input, context: context)
                        try await writer.success(id: id, value: value)
                    } catch is CancellationError {
                        return
                    } catch let error as BackendApplicationError {
                        try? await writer.failure(id: id, error: error)
                    } catch {
                        BackendLogger().error("request \(id) failed: \(error.localizedDescription)")
                        try? await writer.failure(
                            id: id,
                            error: BackendApplicationError(code: "INTERNAL_ERROR", message: "The backend request failed")
                        )
                    }
                }
                await registry.attach(task, id: id)
            }
        }
        await registry.cancelAll()
    }
}

struct InitializePayload: Decodable {
    let protocolVersion: Int
    let type: String
    let parentPid: Int32
    let dataDirectory: String

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case type
        case parentPid
        case dataDirectory
    }
}

enum BackendInboundMessage {
    case request(id: String, method: String, input: JSONValue)
    case shutdown
}

enum BackendProtocol {
    static func validName(_ value: String) -> Bool {
        !value.isEmpty
            && value.utf8.count <= 256
            && value.unicodeScalars.allSatisfy { scalar in
                CharacterSet.alphanumerics.contains(scalar) || "._-".unicodeScalars.contains(scalar)
            }
    }

    static func initialize(_ line: String) throws -> InitializePayload {
        let root = try object(line)
        guard Set(root.keys) == Set(["protocol", "type", "parentPid", "dataDirectory"]),
              root["protocol"] == .number(Double(FIABackendProtocolVersion)),
              root["type"] == .string("initialize"),
              case let .number(parentPidValue) = root["parentPid"],
              parentPidValue.rounded() == parentPidValue,
              parentPidValue > 0,
              case let .string(dataDirectory) = root["dataDirectory"],
              dataDirectory.hasPrefix("/"),
              !dataDirectory.contains("\0")
        else { throw BackendProtocolError.invalidMessage }
        return InitializePayload(
            protocolVersion: FIABackendProtocolVersion,
            type: "initialize",
            parentPid: Int32(parentPidValue),
            dataDirectory: dataDirectory
        )
    }

    static func inbound(_ line: String) throws -> BackendInboundMessage {
        let root = try object(line)
        guard root["protocol"] == .number(Double(FIABackendProtocolVersion)),
              case let .string(type) = root["type"]
        else { throw BackendProtocolError.invalidMessage }
        switch type {
        case "request":
            guard Set(root.keys) == Set(["protocol", "type", "id", "method", "input"]),
                  case let .string(id) = root["id"], validName(id),
                  case let .string(method) = root["method"], validName(method),
                  let input = root["input"]
            else { throw BackendProtocolError.invalidMessage }
            return .request(id: id, method: method, input: input)
        case "shutdown":
            guard Set(root.keys) == Set(["protocol", "type", "reason"]),
                  root["reason"] == .string("applicationQuit")
            else { throw BackendProtocolError.invalidMessage }
            return .shutdown
        default:
            throw BackendProtocolError.invalidMessage
        }
    }

    private static func object(_ line: String) throws -> [String: JSONValue] {
        let data = Data(line.utf8)
        guard data.count <= FIABackendMaximumMessageBytes else { throw BackendProtocolError.messageTooLarge }
        guard case let .object(root) = try JSONDecoder().decode(JSONValue.self, from: data) else {
            throw BackendProtocolError.invalidMessage
        }
        return root
    }
}

enum BackendProtocolError: Error, Equatable {
    case invalidMessage
    case messageTooLarge
}

actor ProtocolWriter {
    private let encoder = JSONEncoder()
    private let output: FileHandle

    init(output: FileHandle = .standardOutput) {
        self.output = output
    }

    func ready(pid: Int32) throws {
        try write(.object([
            "protocol": .number(Double(FIABackendProtocolVersion)),
            "type": .string("ready"),
            "pid": .number(Double(pid)),
        ]))
    }

    func success(id: String, value: JSONValue) throws {
        try write(.object([
            "protocol": .number(Double(FIABackendProtocolVersion)),
            "type": .string("response"),
            "id": .string(id),
            "ok": .bool(true),
            "value": value,
        ]))
    }

    func failure(id: String, error: BackendApplicationError) throws {
        var payload: [String: JSONValue] = [
            "code": .string(error.code),
            "message": .string(error.message),
        ]
        if let details = error.details { payload["details"] = details }
        try write(.object([
            "protocol": .number(Double(FIABackendProtocolVersion)),
            "type": .string("response"),
            "id": .string(id),
            "ok": .bool(false),
            "error": .object(payload),
        ]))
    }

    func event(name: String, payload: JSONValue) throws {
        try write(.object([
            "protocol": .number(Double(FIABackendProtocolVersion)),
            "type": .string("event"),
            "name": .string(name),
            "payload": payload,
        ]))
    }

    private func write(_ value: JSONValue) throws {
        var data = try encoder.encode(value)
        data.append(0x0A)
        guard data.count <= FIABackendMaximumMessageBytes else { throw BackendProtocolError.messageTooLarge }
        try output.write(contentsOf: data)
    }
}

actor RequestRegistry {
    private var tasks: [String: Task<Void, Never>] = [:]
    private var requestIDs = Set<String>()

    func reserve(_ id: String, maximum: Int) -> Bool {
        guard requestIDs.count < maximum, requestIDs.insert(id).inserted else { return false }
        return true
    }

    func attach(_ task: Task<Void, Never>, id: String) {
        guard requestIDs.contains(id) else {
            task.cancel()
            return
        }
        tasks[id] = task
    }

    func remove(_ id: String) {
        requestIDs.remove(id)
        tasks[id] = nil
    }

    func cancelAll() {
        tasks.values.forEach { $0.cancel() }
        tasks.removeAll()
        requestIDs.removeAll()
    }
}

private final class ProtocolLineReader {
    private let input: FileHandle
    private var buffer = Data()

    init(input: FileHandle) {
        self.input = input
    }

    func readLine() throws -> String? {
        while true {
            if let newline = buffer.firstIndex(of: 0x0A) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                return try decode(line)
            }
            guard buffer.count <= FIABackendMaximumMessageBytes else {
                throw BackendProtocolError.messageTooLarge
            }
            let chunk = try readChunk()
            if chunk.isEmpty {
                guard !buffer.isEmpty else { return nil }
                let line = buffer
                buffer.removeAll()
                return try decode(line)
            }
            buffer.append(chunk)
        }
    }

    private func readChunk() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = bytes.withUnsafeMutableBytes { storage in
                Darwin.read(input.fileDescriptor, storage.baseAddress, storage.count)
            }
            if count >= 0 { return Data(bytes.prefix(count)) }
            if errno != EINTR { throw BackendProtocolError.invalidMessage }
        }
    }

    private func decode(_ data: Data) throws -> String {
        guard data.count <= FIABackendMaximumMessageBytes else {
            throw BackendProtocolError.messageTooLarge
        }
        guard let line = String(data: data, encoding: .utf8) else {
            throw BackendProtocolError.invalidMessage
        }
        return line
    }
}
