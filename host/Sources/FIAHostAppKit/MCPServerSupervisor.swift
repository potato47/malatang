import FIAHostCore
import Foundation
import CryptoKit

@MainActor
final class MCPServerSupervisor {
    enum State: String {
        case starting
        case connected
        case restarting
        case stopped
        case failed
    }

    typealias MessageHandler = (_ serverID: String, _ message: [String: Any]) -> Void
    typealias StateHandler = (_ serverID: String, _ state: State, _ reason: String?) -> Void

    private let appIdentifier: String
    private let configurations: [String: HostConfiguration.MCPServer]
    private let applicationSupportDirectory: URL?
    private let onMessage: MessageHandler
    private let onState: StateHandler
    private var servers: [String: ManagedServer] = [:]
    private var activeWrites = 0

    init(
        configuration: HostConfiguration,
        applicationSupportDirectory: URL? = nil,
        onMessage: @escaping MessageHandler,
        onState: @escaping StateHandler
    ) {
        appIdentifier = configuration.app.identifier
        configurations = Dictionary(uniqueKeysWithValues: configuration.mcpServers.map { ($0.id, $0) })
        self.applicationSupportDirectory = applicationSupportDirectory
        self.onMessage = onMessage
        self.onState = onState
    }

    func send(serverID: String, data: Data) throws {
        guard let configuration = configurations[serverID] else {
            throw MCPServerSupervisorError.unknownServer(serverID)
        }
        guard data.count <= FIAMaximumMCPMessageBytes else {
            throw MCPServerSupervisorError.messageTooLarge
        }
        guard activeWrites < FIAMaximumMCPConcurrentMessages else {
            throw MCPServerSupervisorError.concurrencyLimit
        }
        let server = try managedServer(for: configuration)
        activeWrites += 1
        defer { activeWrites -= 1 }
        try server.send(data)
    }

    func restart(serverID: String) {
        guard configurations[serverID] != nil else { return }
        onState(serverID, .restarting, nil)
        servers.removeValue(forKey: serverID)?.stop(emitState: false)
    }

    func restartAll() {
        for id in servers.keys.sorted() { restart(serverID: id) }
    }

    func stopAll() {
        let running = servers
        servers.removeAll()
        for server in running.values { server.stop(emitState: true) }
    }

    private func managedServer(for configuration: HostConfiguration.MCPServer) throws -> ManagedServer {
        if let server = servers[configuration.id], server.isRunning { return server }
        let server = try ManagedServer(
            configuration: configuration,
            appIdentifier: appIdentifier,
            applicationSupportDirectory: applicationSupportDirectory,
            onMessage: onMessage,
            onState: { [weak self] serverID, state, reason in
                guard let self else { return }
                if state == .failed || state == .stopped {
                    self.servers.removeValue(forKey: serverID)
                }
                self.onState(serverID, state, reason)
            }
        )
        servers[configuration.id] = server
        try server.start()
        return server
    }
}

struct MCPStdoutDecoder {
    private var buffer = Data()

    mutating func append(_ data: Data) throws -> [[String: Any]] {
        buffer.append(data)
        var messages: [[String: Any]] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard !line.isEmpty,
                  line.count <= FIAMaximumMCPMessageBytes,
                  let object = try? JSONSerialization.jsonObject(with: Data(line)),
                  let message = object as? [String: Any],
                  message["jsonrpc"] as? String == "2.0"
            else { throw MCPStdoutDecoderError.invalidLine }
            messages.append(message)
        }
        guard buffer.count <= FIAMaximumMCPMessageBytes else {
            throw MCPStdoutDecoderError.messageTooLarge
        }
        return messages
    }

    mutating func reset() {
        buffer.removeAll(keepingCapacity: false)
    }
}

enum MCPStdoutDecoderError: Error {
    case invalidLine
    case messageTooLarge
}

@MainActor
private final class ManagedServer {
    let configuration: HostConfiguration.MCPServer
    private let executableURL: URL
    private let workingDirectoryURL: URL
    private let onMessage: MCPServerSupervisor.MessageHandler
    private let onState: MCPServerSupervisor.StateHandler
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutDecoder = MCPStdoutDecoder()
    private var intentionalStop = false

    var isRunning: Bool { process?.isRunning == true }

    init(
        configuration: HostConfiguration.MCPServer,
        appIdentifier: String,
        applicationSupportDirectory: URL?,
        onMessage: @escaping MCPServerSupervisor.MessageHandler,
        onState: @escaping MCPServerSupervisor.StateHandler
    ) throws {
        self.configuration = configuration
        self.onMessage = onMessage
        self.onState = onState
        executableURL = try Self.resolveExecutable(configuration.executable, sha256: configuration.sha256)
        let applicationSupport = try applicationSupportDirectory ?? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        workingDirectoryURL = applicationSupport
            .appendingPathComponent(appIdentifier, isDirectory: true)
            .appendingPathComponent("MCPServers", isDirectory: true)
            .appendingPathComponent(configuration.id, isDirectory: true)
        try FileManager.default.createDirectory(
            at: workingDirectoryURL,
            withIntermediateDirectories: true
        )
    }

    func start() throws {
        guard process == nil else { return }
        onState(configuration.id, .starting, nil)

        let process = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.executableURL = executableURL
        process.arguments = configuration.arguments
        process.currentDirectoryURL = workingDirectoryURL
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        process.environment = [
            "PATH": "/usr/bin:/bin",
            "TMPDIR": FileManager.default.temporaryDirectory.path,
        ]
        process.terminationHandler = { [weak self] process in
            Task { @MainActor [weak self] in
                self?.terminated(status: process.terminationStatus)
            }
        }
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { @MainActor [weak self] in self?.consumeStdout(data) }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [configuration] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            let text = String(decoding: data, as: UTF8.self)
            try? FileHandle.standardError.write(contentsOf: Data("[mcp:\(configuration.id)] \(text)".utf8))
        }
        do {
            try process.run()
        } catch {
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            onState(configuration.id, .failed, error.localizedDescription)
            throw MCPServerSupervisorError.couldNotStart(configuration.id)
        }
        self.process = process
        self.stdinPipe = stdinPipe
        intentionalStop = false
        onState(configuration.id, .connected, nil)
    }

    func send(_ message: Data) throws {
        guard isRunning, let stdinPipe else {
            throw MCPServerSupervisorError.notRunning(configuration.id)
        }
        var line = message
        line.append(0x0A)
        do {
            try stdinPipe.fileHandleForWriting.write(contentsOf: line)
        } catch {
            fail("stdin write failed: \(error.localizedDescription)")
            throw MCPServerSupervisorError.writeFailed(configuration.id)
        }
    }

    func stop(emitState: Bool) {
        intentionalStop = true
        stdinPipe?.fileHandleForWriting.closeFile()
        if let process, process.isRunning {
            process.terminate()
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        }
        cleanup()
        if emitState { onState(configuration.id, .stopped, nil) }
    }

    private func consumeStdout(_ data: Data) {
        do {
            for message in try stdoutDecoder.append(data) {
                onMessage(configuration.id, message)
            }
        } catch MCPStdoutDecoderError.messageTooLarge {
            fail("stdout message exceeds the 1 MiB limit")
        } catch {
            fail("stdout contained a non-MCP line")
        }
    }

    private func terminated(status: Int32) {
        let wasIntentional = intentionalStop
        cleanup()
        if !wasIntentional {
            onState(configuration.id, .failed, "server exited with status \(status)")
        }
    }

    private func fail(_ reason: String) {
        intentionalStop = true
        if process?.isRunning == true { process?.terminate() }
        cleanup()
        onState(configuration.id, .failed, reason)
    }

    private func cleanup() {
        if let output = process?.standardOutput as? Pipe {
            output.fileHandleForReading.readabilityHandler = nil
        }
        if let error = process?.standardError as? Pipe {
            error.fileHandleForReading.readabilityHandler = nil
        }
        process = nil
        stdinPipe = nil
        stdoutDecoder.reset()
    }

    private static func resolveExecutable(_ value: String, sha256 expectedSHA256: String) throws -> URL {
        let candidate: URL
        if value.hasPrefix("/") {
            candidate = URL(fileURLWithPath: value)
        } else {
            candidate = Bundle.main.bundleURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent(value, isDirectory: false)
        }
        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
        guard FileManager.default.isExecutableFile(atPath: resolved.path) else {
            throw MCPServerSupervisorError.invalidExecutable(value)
        }
        // Absolute paths are used only by `fia dev`, where watched executables
        // are intentionally replaced without reloading the Host configuration.
        // Packaged relative paths are immutable and always integrity checked.
        if !value.hasPrefix("/") {
            guard let data = try? Data(contentsOf: resolved, options: [.mappedIfSafe]) else {
                throw MCPServerSupervisorError.invalidExecutable(value)
            }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == expectedSHA256 else { throw MCPServerSupervisorError.checksumMismatch(value) }
        }
        return resolved
    }
}

enum MCPServerSupervisorError: Error, LocalizedError {
    case unknownServer(String)
    case invalidExecutable(String)
    case checksumMismatch(String)
    case couldNotStart(String)
    case notRunning(String)
    case writeFailed(String)
    case messageTooLarge
    case concurrencyLimit

    var errorDescription: String? {
        switch self {
        case let .unknownServer(id): "Unknown MCP server \(id)"
        case let .invalidExecutable(path): "Invalid MCP server executable \(path)"
        case let .checksumMismatch(path): "MCP server checksum does not match \(path)"
        case let .couldNotStart(id): "Could not start MCP server \(id)"
        case let .notRunning(id): "MCP server \(id) is not running"
        case let .writeFailed(id): "Could not write to MCP server \(id)"
        case .messageTooLarge: "MCP message exceeds the 1 MiB limit"
        case .concurrencyLimit: "MCP concurrency limit exceeded"
        }
    }
}
