import CryptoKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class BackendSupervisor {
    enum State: Equatable {
        case starting
        case ready(port: Int)
        case restarting(attempt: Int)
        case failed(reason: String)
        case stopping
        case stopped
    }

    typealias RequestHandler = @MainActor (_ method: String, _ params: [String: Any]) async throws -> Any?

    private let configuration: HostConfiguration
    private let executableURL: URL
    private let workingDirectoryURL: URL
    private let onRequest: RequestHandler
    private let onState: (State) -> Void
    private let sessionSecret = UUID().uuidString + UUID().uuidString
    private let retryDelays: [Duration] = [.milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8)]

    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutDecoder = BackendStdoutDecoder()
    private var generation = UUID()
    private var preferredPort = 0
    private var retryAttempt = 0
    private var requestTasks: [Int: Task<Void, Never>] = [:]
    private var stopping = false
    private var startupTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var stableTask: Task<Void, Never>?
    private var shutdownTask: Task<Void, Never>?

    init(
        configuration: HostConfiguration,
        applicationSupportDirectory: URL? = nil,
        onRequest: @escaping RequestHandler,
        onState: @escaping (State) -> Void
    ) throws {
        self.configuration = configuration
        self.onRequest = onRequest
        self.onState = onState
        executableURL = try Self.resolveExecutable(configuration)
        workingDirectoryURL = try Self.workingDirectory(
            configuration: configuration,
            applicationSupportDirectory: applicationSupportDirectory
        )
    }

    static func workingDirectory(
        configuration: HostConfiguration,
        applicationSupportDirectory: URL? = nil
    ) throws -> URL {
        let applicationSupport = try applicationSupportDirectory ?? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = applicationSupport
            .appendingPathComponent(configuration.app.identifier, isDirectory: true)
            .appendingPathComponent("Backend", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    deinit {
        startupTask?.cancel()
        retryTask?.cancel()
        stableTask?.cancel()
        shutdownTask?.cancel()
        requestTasks.values.forEach { $0.cancel() }
    }

    func start() {
        guard process == nil, !stopping else { return }
        launch()
    }

    func retry() {
        retryTask?.cancel()
        retryAttempt = 0
        stopping = false
        if let process, process.isRunning { process.terminate() } else { launch() }
    }

    func sendEvent(_ event: String, payload: Any? = nil) {
        guard process?.isRunning == true else { return }
        var frame: [String: Any] = ["v": FIAStdioProtocolVersion, "type": "event", "event": event]
        if let payload { frame["payload"] = payload }
        try? write(frame)
    }

    @discardableResult
    func stop() -> Bool {
        guard !stopping else { return process?.isRunning == true }
        stopping = true
        retryTask?.cancel()
        stableTask?.cancel()
        Array(requestTasks.keys).forEach { cancelRequest($0) }
        onState(.stopping)
        guard let process, process.isRunning else {
            cleanup()
            onState(.stopped)
            return false
        }
        sendEvent("host.shutdown")
        shutdownTask?.cancel()
        shutdownTask = Task { @MainActor [weak process] in
            try? await Task.sleep(for: .seconds(5))
            guard let process, process.isRunning else { return }
            process.terminate()
            try? await Task.sleep(for: .seconds(2))
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        return true
    }

    private func launch() {
        requestTasks.values.forEach { $0.cancel() }
        requestTasks.removeAll()
        generation = UUID()
        let currentGeneration = generation
        stdoutDecoder.reset()
        onState(retryAttempt == 0 ? .starting : .restarting(attempt: retryAttempt))
        let process = Process()
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.executableURL = executableURL
        process.arguments = configuration.backend.arguments
        process.currentDirectoryURL = configuration.development
            ? URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            : workingDirectoryURL
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe
        process.environment = configuration.development
            ? ProcessInfo.processInfo.environment
            : ["PATH": "/usr/bin:/bin", "TMPDIR": FileManager.default.temporaryDirectory.path]
        diagnostic(
            "launching Backend: \(executableURL.path) "
                + configuration.backend.arguments.map { String(reflecting: $0) }.joined(separator: " ")
        )
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async { [weak self] in
                self?.terminated(process: process, generation: currentGeneration)
            }
        }
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            Task { @MainActor [weak self] in self?.consumeStdout(data, generation: currentGeneration) }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            try? FileHandle.standardError.write(contentsOf: Data("[backend] ".utf8) + data)
        }
        do {
            try process.run()
        } catch {
            diagnostic("Backend launch failed: \(error.localizedDescription)")
            cleanup(process: process)
            scheduleRetry(reason: "could not start Backend: \(error.localizedDescription)")
            return
        }
        diagnostic("Backend launched with pid \(process.processIdentifier)")
        self.process = process
        self.stdinPipe = stdinPipe
        do {
            try write([
                "v": FIAStdioProtocolVersion,
                "type": "initialize",
                "sessionSecret": sessionSecret,
                "preferredPort": preferredPort,
                "development": configuration.development,
                "applicationSupport": workingDirectoryURL.path,
                "app": ["name": configuration.app.name, "identifier": configuration.app.identifier],
            ])
            diagnostic("sent Backend initialize frame")
        } catch {
            diagnostic("could not send Backend initialize frame: \(error.localizedDescription)")
            process.terminate()
            return
        }
        startupTask?.cancel()
        startupTask = Task { @MainActor [weak self, weak process] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled,
                  let self, let process, process.isRunning,
                  self.generation == currentGeneration else { return }
            self.diagnostic("Backend readiness timed out for pid \(process.processIdentifier)")
            self.failCurrent("Backend readiness timed out")
        }
    }

    private func consumeStdout(_ data: Data, generation: UUID) {
        guard self.generation == generation else { return }
        diagnostic("received \(data.count) Backend stdout bytes")
        do {
            for frame in try stdoutDecoder.append(data) { try consume(frame) }
        } catch {
            failCurrent("Backend stdout violated stdio protocol: \(error)")
        }
    }

    private func consume(_ frame: [String: Any]) throws {
        guard let type = frame["type"] as? String else { throw BackendProtocolError.invalidFrame }
        switch type {
        case "ready":
            guard Set(frame.keys) == ["v", "type", "port", "origin"],
                  let port = frame["port"] as? Int, (1 ... 65_535).contains(port),
                  frame["origin"] as? String == "http://127.0.0.1:\(port)"
            else { throw BackendProtocolError.invalidFrame }
            diagnostic("Backend ready on port \(port)")
            startupTask?.cancel()
            preferredPort = port
            onState(.ready(port: port))
            stableTask?.cancel()
            stableTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.retryAttempt = 0
            }
        case "request":
            guard Set(frame.keys) == ["v", "type", "id", "method", "params"],
                  let id = frame["id"] as? Int, id > 0,
                  let method = frame["method"] as? String, !method.isEmpty,
                  let params = frame["params"] as? [String: Any],
                  requestTasks[id] == nil,
                  requestTasks.count < FIAMaximumPendingRequests
            else { throw BackendProtocolError.invalidFrame }
            let requestGeneration = generation
            requestTasks[id] = Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    let result = try await self.onRequest(method, params)
                    try Task.checkCancellation()
                    self.finishRequest(id: id, generation: requestGeneration, result: result)
                } catch is CancellationError {
                    self.finishRequest(
                        id: id,
                        generation: requestGeneration,
                        error: .cancelled,
                        message: "Host request was cancelled"
                    )
                } catch let error as HostRequestExecutionError {
                    if Task.isCancelled {
                        self.finishRequest(
                            id: id,
                            generation: requestGeneration,
                            error: .cancelled,
                            message: "Host request was cancelled"
                        )
                    } else {
                        self.finishRequest(
                            id: id,
                            generation: requestGeneration,
                            error: error.code,
                            message: error.message
                        )
                    }
                } catch {
                    self.finishRequest(
                        id: id,
                        generation: requestGeneration,
                        error: Task.isCancelled ? .cancelled : .nativeFailure,
                        message: Task.isCancelled ? "Host request was cancelled" : error.localizedDescription
                    )
                }
            }
        case "cancel":
            guard Set(frame.keys) == ["v", "type", "id"],
                  let id = frame["id"] as? Int, id > 0
            else { throw BackendProtocolError.invalidFrame }
            cancelRequest(id)
        default: throw BackendProtocolError.invalidFrame
        }
    }

    private func cancelRequest(_ id: Int) {
        guard let task = requestTasks.removeValue(forKey: id) else { return }
        task.cancel()
        try? write([
            "v": FIAStdioProtocolVersion,
            "type": "response",
            "id": id,
            "error": [
                "code": HostRequestErrorCode.cancelled.rawValue,
                "message": "Host request was cancelled",
            ],
        ])
    }

    private func finishRequest(id: Int, generation: UUID, result: Any?) {
        guard self.generation == generation, requestTasks.removeValue(forKey: id) != nil else { return }
        do {
            try write(["v": FIAStdioProtocolVersion, "type": "response", "id": id, "result": result ?? NSNull()])
        } catch {
            try? write([
                "v": FIAStdioProtocolVersion,
                "type": "response",
                "id": id,
                "error": [
                    "code": HostRequestErrorCode.invalidArgument.rawValue,
                    "message": "Host response exceeds the protocol frame limit",
                ],
            ])
        }
    }

    private func finishRequest(id: Int, generation: UUID, error: HostRequestErrorCode, message: String) {
        guard self.generation == generation, requestTasks.removeValue(forKey: id) != nil else { return }
        try? write([
            "v": FIAStdioProtocolVersion,
            "type": "response",
            "id": id,
            "error": ["code": error.rawValue, "message": message],
        ])
    }

    private func write(_ frame: [String: Any]) throws {
        guard let stdinPipe else { throw BackendSupervisorError.notRunning }
        var data = try JSONSerialization.data(withJSONObject: frame)
        guard data.count <= FIAMaximumStdioFrameBytes else { throw BackendSupervisorError.frameTooLarge }
        data.append(0x0A)
        try stdinPipe.fileHandleForWriting.write(contentsOf: data)
    }

    private func failCurrent(_ reason: String) {
        diagnostic("failing Backend: \(reason)")
        startupTask?.cancel()
        stableTask?.cancel()
        guard let process else {
            scheduleRetry(reason: reason)
            return
        }
        process.terminationHandler = nil
        if process.isRunning { process.terminate() }
        cleanup(process: process)
        scheduleRetry(reason: reason)
    }

    private func terminated(process: Process, generation: UUID) {
        guard self.generation == generation else { return }
        let status = process.terminationStatus
        diagnostic("Backend pid \(process.processIdentifier) exited with status \(status)")
        cleanup(process: process)
        if stopping {
            onState(.stopped)
        } else {
            scheduleRetry(reason: "Backend exited with status \(status)")
        }
    }

    private func scheduleRetry(reason: String) {
        guard !stopping else { return }
        startupTask?.cancel()
        stableTask?.cancel()
        guard retryAttempt < retryDelays.count else {
            diagnostic("Backend retries exhausted: \(reason)")
            onState(.failed(reason: reason))
            return
        }
        let delay = retryDelays[retryAttempt]
        retryAttempt += 1
        onState(.restarting(attempt: retryAttempt))
        retryTask?.cancel()
        retryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, !Task.isCancelled, !self.stopping else { return }
            self.launch()
        }
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost Backend: \(message)\n".utf8))
    }

    private func cleanup(process: Process? = nil) {
        requestTasks.values.forEach { $0.cancel() }
        requestTasks.removeAll()
        let target = process ?? self.process
        if let output = target?.standardOutput as? Pipe { output.fileHandleForReading.readabilityHandler = nil }
        if let error = target?.standardError as? Pipe { error.fileHandleForReading.readabilityHandler = nil }
        if self.process === target || process == nil {
            self.process = nil
            stdinPipe = nil
            stdoutDecoder.reset()
        }
        startupTask?.cancel()
    }

    private static func resolveExecutable(_ configuration: HostConfiguration) throws -> URL {
        let value = configuration.backend.executable
        let candidate = value.hasPrefix("/")
            ? URL(fileURLWithPath: value)
            : Bundle.main.bundleURL.appendingPathComponent("Contents", isDirectory: true).appendingPathComponent(value)
        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
        guard FileManager.default.isExecutableFile(atPath: resolved.path) else {
            throw BackendSupervisorError.invalidExecutable(value)
        }
        if !configuration.development {
            let data = try Data(contentsOf: resolved, options: [.mappedIfSafe])
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard digest == configuration.backend.sha256 else { throw BackendSupervisorError.checksumMismatch }
        }
        return resolved
    }
}

enum BackendSupervisorError: Error, LocalizedError {
    case invalidExecutable(String)
    case checksumMismatch
    case notRunning
    case frameTooLarge

    var errorDescription: String? {
        switch self {
        case let .invalidExecutable(path): "Invalid Backend executable \(path)"
        case .checksumMismatch: "Backend checksum does not match"
        case .notRunning: "Backend is not running"
        case .frameTooLarge: "stdio frame exceeds the 1 MiB limit"
        }
    }
}
