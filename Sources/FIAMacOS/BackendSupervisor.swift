import CryptoKit
import Darwin
import FIACore
import Foundation

public struct FIABunConfiguration: Sendable {
    public let development: Bool
    public let appName: String
    public let appIdentifier: String
    public let executable: String
    public let arguments: [String]
    public let sha256: String
    public let nativeOrigin: String
    public let nativeSession: String

    public init(
        development: Bool,
        appName: String,
        appIdentifier: String,
        executable: String,
        arguments: [String] = [],
        sha256: String,
        nativeOrigin: String,
        nativeSession: String
    ) {
        self.development = development
        self.appName = appName
        self.appIdentifier = appIdentifier
        self.executable = executable
        self.arguments = arguments
        self.sha256 = sha256
        self.nativeOrigin = nativeOrigin
        self.nativeSession = nativeSession
    }
}

@MainActor
public final class BackendSupervisor {
    public enum State: Equatable, Sendable {
        case starting
        case ready(port: Int)
        case restarting(attempt: Int)
        case failed(reason: String)
        case stopping
        case stopped
    }

    public typealias RequestHandler = @MainActor (_ method: String, _ params: Any) async throws -> Any?

    private let configuration: FIABunConfiguration
    private let executableURL: URL
    private let workingDirectoryURL: URL
    private let onRequest: RequestHandler
    private let onState: (State) -> Void
    private let sessionSecret = UUID().uuidString + UUID().uuidString
    public var sessionToken: String { sessionSecret }
    private let retryDelays: [Duration] = [.milliseconds(500), .seconds(1), .seconds(2), .seconds(4), .seconds(8)]

    private var process: ManagedProcess?
    private var stdoutDecoder = BackendStdoutDecoder()
    private var generation = UUID()
    private var preferredPort = 0
    private var retryAttempt = 0
    private var requestTasks: [Int: Task<Void, Never>] = [:]
    private var stopping = false
    private var startupTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var stableTask: Task<Void, Never>?
    private var shutdownTask: Task<Void, Error>?
    private var recoveryTask: Task<Void, Never>?

    public init(
        configuration: FIABunConfiguration,
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
        configuration: FIABunConfiguration,
        applicationSupportDirectory: URL? = nil
    ) throws -> URL {
        let applicationSupport = try applicationSupportDirectory ?? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = applicationSupport
            .appendingPathComponent(configuration.appIdentifier, isDirectory: true)
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

    public func start() {
        guard process == nil, !stopping else { return }
        launch()
    }

    public func retry() {
        guard !stopping else { return }
        retryTask?.cancel()
        retryAttempt = 0
        if process != nil { failCurrent("Manual retry") } else { launch() }
    }

    public func sendEvent(_ event: String, payload: Any? = nil) {
        guard process?.isRunning == true else { return }
        var frame: [String: Any] = ["v": FIAStdioProtocolVersion, "type": "event", "event": event]
        if let payload { frame["payload"] = payload }
        try? write(frame)
    }

    public func stop() async throws {
        if let shutdownTask { return try await shutdownTask.value }
        stopping = true
        retryTask?.cancel()
        startupTask?.cancel()
        stableTask?.cancel()
        Array(requestTasks.keys).forEach { cancelRequest($0) }
        onState(.stopping)
        let task = Task { @MainActor in
            if let process = self.process {
                try await process.stop { self.sendEvent("runtime.shutdown") }
                self.cleanup(process: process)
            }
            self.onState(.stopped)
        }
        shutdownTask = task
        do { try await task.value } catch {
            shutdownTask = nil
            onState(.failed(reason: error.localizedDescription))
            throw error
        }
    }

    private func launch() {
        requestTasks.values.forEach { $0.cancel() }
        requestTasks.removeAll()
        generation = UUID()
        let currentGeneration = generation
        stdoutDecoder.reset()
        onState(retryAttempt == 0 ? .starting : .restarting(attempt: retryAttempt))
        let process = ManagedProcess(
            executable: executableURL,
            arguments: configuration.arguments,
            workingDirectory: configuration.development
                ? URL(fileURLWithPath: FileManager.default.currentDirectoryPath) : workingDirectoryURL,
            environment: configuration.development ? ProcessInfo.processInfo.environment
                : ["PATH": "/usr/bin:/bin", "TMPDIR": FileManager.default.temporaryDirectory.path]
        )
        process.onExit = { [weak self, weak process] status in
            guard let self, let process, self.generation == currentGeneration else { return }
            if !self.stopping { self.failCurrent("Backend exited with status \(status)") }
            _ = process
        }
        process.onInputError = { [weak self] error in
            guard self?.generation == currentGeneration else { return }
            self?.failCurrent(error.localizedDescription)
        }
        process.onOutput = { [weak self] output in
            if case .stdout = output.channel { self?.consumeStdout(output.data, generation: currentGeneration) }
        }
        self.process = process
        do { try process.start() } catch {
            cleanup(process: process)
            scheduleRetry(reason: "could not start Backend: \(error.localizedDescription)")
            return
        }
        do {
            try write([
                "v": FIAStdioProtocolVersion,
                "type": "initialize",
                "sessionSecret": sessionSecret,
                "preferredPort": preferredPort,
                "development": configuration.development,
                "applicationSupport": workingDirectoryURL.path,
                "nativeOrigin": configuration.nativeOrigin,
                "nativeSession": configuration.nativeSession,
                "app": ["name": configuration.appName, "identifier": configuration.appIdentifier],
            ])
            diagnostic("sent Backend initialize frame")
        } catch {
            diagnostic("could not send Backend initialize frame: \(error.localizedDescription)")
            failCurrent("Could not initialize Backend")
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
                  let params = frame["params"],
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
                        message: "Native request was cancelled"
                    )
                } catch let error as FIAError {
                    self.finishRequest(id: id, generation: requestGeneration, error: error)
                } catch {
                    self.finishRequest(
                        id: id,
                        generation: requestGeneration,
                        error: Task.isCancelled ? .cancelled : .nativeFailure,
                        message: Task.isCancelled ? "Native request was cancelled" : error.localizedDescription
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
                "code": FIAErrorCode.cancelled.rawValue,
                "component": "native",
                "method": "cancel",
                "message": "Native request was cancelled",
                "recoverable": true,
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
                    "code": FIAErrorCode.invalidArgument.rawValue,
                    "component": "native",
                    "method": "dispatch",
                    "message": "Native response exceeds the protocol frame limit",
                    "recoverable": false,
                ],
            ])
        }
    }

    private func finishRequest(id: Int, generation: UUID, error: FIAErrorCode, message: String) {
        guard self.generation == generation, requestTasks.removeValue(forKey: id) != nil else { return }
        try? write([
            "v": FIAStdioProtocolVersion,
            "type": "response",
            "id": id,
            "error": [
                "code": error.rawValue,
                "component": "native",
                "method": "dispatch",
                "message": message,
                "recoverable": error == .timeout || error == .cancelled,
            ],
        ])
    }

    private func finishRequest(id: Int, generation: UUID, error: FIAError) {
        guard self.generation == generation, requestTasks.removeValue(forKey: id) != nil else { return }
        let details: Any = error.details.flatMap { value in
            guard let data = try? JSONEncoder().encode(value) else { return nil }
            return try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
        } ?? NSNull()
        var payload: [String: Any] = [
            "code": error.code.rawValue,
            "component": error.component,
            "message": error.message,
            "recoverable": error.recoverable,
            "details": details,
        ]
        if let method = error.method { payload["method"] = method }
        try? write([
            "v": FIAStdioProtocolVersion,
            "type": "response",
            "id": id,
            "error": payload,
        ])
    }

    private func write(_ frame: [String: Any]) throws {
        guard let process else { throw BackendSupervisorError.notRunning }
        var data = try JSONSerialization.data(withJSONObject: frame)
        guard data.count <= FIAMaximumStdioFrameBytes else { throw BackendSupervisorError.frameTooLarge }
        data.append(0x0A)
        try process.write(data)
    }

    private func failCurrent(_ reason: String) {
        guard !stopping, recoveryTask == nil else { return }
        startupTask?.cancel()
        stableTask?.cancel()
        let oldGeneration = generation
        recoveryTask = Task { @MainActor in
            defer { self.recoveryTask = nil }
            do {
                if let process = self.process {
                    try await process.stop(policy: .init(graceful: .zero))
                    guard self.generation == oldGeneration else { return }
                    self.cleanup(process: process)
                }
                self.scheduleRetry(reason: reason)
            } catch { self.onState(.failed(reason: error.localizedDescription)) }
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
        try? FileHandle.standardError.write(contentsOf: Data("FIA Bun runtime: \(message)\n".utf8))
    }

    private func cleanup(process: ManagedProcess? = nil) {
        requestTasks.values.forEach { $0.cancel() }
        requestTasks.removeAll()
        if let process { process.onOutput = nil; process.onExit = nil; process.onInputError = nil }
        if process == nil || self.process === process {
            self.process = nil
            stdoutDecoder.reset()
        }
        startupTask?.cancel()
    }

    private static func resolveExecutable(_ configuration: FIABunConfiguration) throws -> URL {
        let value = configuration.executable
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
            guard digest == configuration.sha256 else { throw BackendSupervisorError.checksumMismatch }
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
