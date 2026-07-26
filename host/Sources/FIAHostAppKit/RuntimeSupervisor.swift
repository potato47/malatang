import Darwin
import FIAHostCore
import Foundation
import OSLog

@MainActor
// Owns the managed Bun process for the lifetime of the AppKit host.
final class RuntimeSupervisor: NSObject {
    enum Event {
        case ready(bootstrapURL: URL)
        case applicationEvent(name: String, payload: Data)
        case failed(title: String, detail: String)
    }

    private struct PendingRequest {
        let continuation: CheckedContinuation<Data, Error>
        let timeout: Task<Void, Never>
    }

    private struct HealthResponse: Decodable {
        let `protocol`: Int
        let status: String
        let pid: Int32
    }

    private let configuration: HostConfiguration
    private let bundle: Bundle
    private let onEvent: (Event) -> Void
    private let requestTimeout: Duration
    private let logger = Logger(subsystem: "dev.fia.host", category: "runtime")

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var errorPipe: Pipe?
    private var outputBuffer = Data()
    private var recentError = Data()
    private var lifecycle = ShutdownStateMachine()
    private var startupTimeoutTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    private var gracefulWorkItem: DispatchWorkItem?
    private var sigtermWorkItem: DispatchWorkItem?
    private var stopCompletions: [() -> Void] = []
    private var expectedExit = false
    private var failureDelivered = false
    private var readyDelivered = false
    private var controlToken: String?
    private var healthFailures = 0
    private var dataDirectory: URL?
    private var pending: [String: PendingRequest] = [:]

    init(
        configuration: HostConfiguration,
        bundle: Bundle = .main,
        requestTimeout: Duration = .seconds(30),
        onEvent: @escaping (Event) -> Void
    ) {
        self.configuration = configuration
        self.bundle = bundle
        self.requestTimeout = requestTimeout
        self.onEvent = onEvent
        super.init()
    }

    var isRunning: Bool { process?.isRunning == true }
    var isReady: Bool { readyDelivered && isRunning }
    var processIdentifier: Int32? { process?.processIdentifier }

    func start() {
        guard process == nil else { return }
        resetRunState()

        do {
            let launch = try locateRuntime()
            let dataDirectory = try createDataDirectory()
            let bootstrapToken = try RuntimeProtocol.secureToken()
            let controlToken = try RuntimeProtocol.secureToken()
            guard bootstrapToken != controlToken else { throw RuntimeLocationError.duplicateToken }

            let process = Process()
            let input = Pipe()
            let output = Pipe()
            let error = Pipe()
            process.executableURL = launch.executable
            process.arguments = launch.arguments
            process.currentDirectoryURL = dataDirectory
            process.standardInput = input
            process.standardOutput = output
            process.standardError = error
            process.terminationHandler = { [weak self] terminatedProcess in
                self?.enqueueProcessExit(status: terminatedProcess.terminationStatus)
            }

            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                Task { @MainActor [weak self] in
                    self?.receiveStdout(data)
                }
            }
            error.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                Task { @MainActor [weak self] in
                    self?.receiveStderr(data)
                }
            }

            try process.run()
            diagnostic("runtime launched with pid \(process.processIdentifier)")
            self.process = process
            inputPipe = input
            outputPipe = output
            errorPipe = error
            self.controlToken = controlToken
            bootstrapTokenForWebView = bootstrapToken
            self.dataDirectory = dataDirectory

            let initialize = InitializeMessage(
                bootstrapToken: bootstrapToken,
                controlToken: controlToken,
                parentPid: getpid(),
                dataDirectory: dataDirectory.path
            )
            try input.fileHandleForWriting.write(contentsOf: RuntimeProtocol.encodeLine(initialize))
            try writePIDFile(process.processIdentifier, in: dataDirectory)

            startupTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { return }
                self?.fail(title: "Runtime startup timed out", detail: "No valid ready message arrived within 10 seconds.")
            }
        } catch {
            cleanDetachedPipes()
            fail(title: "Runtime could not start", detail: error.localizedDescription)
        }
    }

    func restart() {
        rejectPending(code: .backendRestarted, message: "The Bun backend restarted")
        stop { [weak self] in self?.start() }
    }

    func invoke(_ request: BackendBridgeRequest) async throws -> Data {
        guard isReady, let inputPipe else {
            throw BackendInvocationError(code: .backendUnavailable, message: "The FIA Bun backend is unavailable")
        }
        guard pending.count < FIABackendMaximumConcurrentRequests else {
            throw BackendInvocationError(
                code: .backendUnavailable,
                message: "The Bun backend has too many in-flight requests"
            )
        }
        let id = UUID().uuidString.lowercased()
        let requestTimeout = self.requestTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let timeout = Task { @MainActor [weak self] in
                try? await Task.sleep(for: requestTimeout)
                guard !Task.isCancelled else { return }
                self?.cancelBackendRequest(id: id)
                self?.finish(
                    id: id,
                    result: .failure(BackendInvocationError(
                        code: .backendTimeout,
                        message: "The Bun backend request timed out"
                    ))
                )
            }
            pending[id] = PendingRequest(continuation: continuation, timeout: timeout)
            do {
                try inputPipe.fileHandleForWriting.write(contentsOf: BackendProcessProtocol.encodeRequest(
                    id: id,
                    method: request.method,
                    input: request.input
                ))
            } catch {
                finish(id: id, result: .failure(BackendInvocationError(
                    code: .backendUnavailable,
                    message: "The Bun backend request could not be sent"
                )))
            }
        }
    }

    private func cancelBackendRequest(id: String) {
        guard pending[id] != nil else { return }
        do {
            try inputPipe?.fileHandleForWriting.write(contentsOf: BackendProcessProtocol.encodeCancel(id: id))
        } catch {
            diagnostic("could not cancel backend request \(id)")
        }
    }

    func stop(completion: @escaping () -> Void) {
        guard let process else {
            completion()
            return
        }
        stopCompletions.append(completion)
        guard lifecycle.requestStop() == .sendShutdown else { return }
        diagnostic("beginning graceful runtime shutdown")
        expectedExit = true
        startupTimeoutTask?.cancel()
        healthTask?.cancel()
        rejectPending(code: .backendUnavailable, message: "The Bun backend stopped")

        do {
            if let inputPipe {
                try inputPipe.fileHandleForWriting.write(contentsOf: RuntimeProtocol.encodeLine(ShutdownMessage()))
                try inputPipe.fileHandleForWriting.close()
            }
        } catch {
            logger.error("Could not send graceful shutdown: \(error.localizedDescription, privacy: .public)")
        }

        let expectedPID = process.processIdentifier
        let terminator = RuntimeTerminator(process: process, pid: expectedPID)
        let (gracefulWorkItem, sigtermWorkItem) = terminator.makeWorkItems()
        self.gracefulWorkItem = gracefulWorkItem
        self.sigtermWorkItem = sigtermWorkItem
        DispatchQueue.global(qos: .userInitiated).asyncAfter(
            deadline: .now() + 2,
            execute: gracefulWorkItem
        )
    }

    func forceStop() {
        guard let process, process.isRunning else { return }
        expectedExit = true
        Darwin.kill(process.processIdentifier, SIGKILL)
    }

    private func resetRunState() {
        outputBuffer.removeAll(keepingCapacity: true)
        recentError.removeAll(keepingCapacity: true)
        lifecycle = ShutdownStateMachine()
        expectedExit = false
        failureDelivered = false
        readyDelivered = false
        healthFailures = 0
        controlToken = nil
        bootstrapTokenForWebView = nil
        gracefulWorkItem?.cancel()
        sigtermWorkItem?.cancel()
        gracefulWorkItem = nil
        sigtermWorkItem = nil
    }

    private struct RuntimeLaunch {
        let executable: URL
        let arguments: [String]
    }

    private func locateRuntime() throws -> RuntimeLaunch {
        let url: URL
        let arguments: [String]
        switch configuration.runtime.mode {
        case .bundled:
            throw RuntimeLocationError.bundledRuntimeHasNoProcess
        case .production:
            url = bundle.bundleURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("MacOS", isDirectory: true)
                .appendingPathComponent("fia-runtime", isDirectory: false)
            arguments = []
        case .development:
            guard let executable = configuration.runtime.executable,
                  let configuredArguments = configuration.runtime.arguments
            else { throw RuntimeLocationError.invalidDevelopmentConfiguration }
            url = URL(fileURLWithPath: executable, isDirectory: false)
            arguments = configuredArguments
        }
        guard FileManager.default.isExecutableFile(atPath: url.path) else {
            throw RuntimeLocationError.missingExecutable(url.path)
        }
        return RuntimeLaunch(executable: url, arguments: arguments)
    }

    private func createDataDirectory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent(configuration.app.identifier, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: directory.appendingPathComponent("logs", isDirectory: true),
            withIntermediateDirectories: true
        )
        return directory.resolvingSymlinksInPath()
    }

    private func writePIDFile(_ pid: Int32, in directory: URL) throws {
        let file = directory.appendingPathComponent("runtime.pid")
        try Data("\(pid)\n".utf8).write(to: file, options: .atomic)
    }

    private func removePIDFile() {
        guard let dataDirectory else { return }
        try? FileManager.default.removeItem(at: dataDirectory.appendingPathComponent("runtime.pid"))
    }

    private func receiveStdout(_ data: Data) {
        guard !data.isEmpty else {
            if !readyDelivered && process?.isRunning == true {
                fail(title: "Runtime startup failed", detail: "Runtime closed stdout before sending ready.")
            }
            return
        }
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 0x0A) {
            let line = Data(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            guard !line.isEmpty else { continue }
            do {
                guard let process else { return }
                if !readyDelivered {
                    let ready = try RuntimeProtocol.decodeReadyLine(line, expectedPID: process.processIdentifier)
                    diagnostic("runtime ready on port \(ready.port)")
                    readyDelivered = true
                    startupTimeoutTask?.cancel()
                    let origin = URL(string: "http://127.0.0.1:\(ready.port)")!
                    performInitialHealthProbe(origin: origin)
                } else {
                    try receiveBackend(BackendProcessProtocol.decodeLine(
                        line,
                        expectedPID: process.processIdentifier
                    ))
                }
            } catch {
                fail(title: "Runtime protocol error", detail: error.localizedDescription)
                return
            }
        }
        let maximum = readyDelivered ? FIABackendMaximumMessageBytes : FIAMaximumControlLineBytes
        guard outputBuffer.count <= maximum else {
            fail(title: "Runtime protocol error", detail: "Runtime protocol message is too large.")
            return
        }
    }

    private func receiveBackend(_ message: BackendProcessMessage) throws {
        switch message {
        case .ready:
            throw BackendProtocolError.invalidMessage
        case let .success(id, value):
            guard pending[id] != nil else { throw BackendProtocolError.invalidMessage }
            finish(id: id, result: .success(value))
        case let .failure(id, code, message, details):
            guard pending[id] != nil else { throw BackendProtocolError.invalidMessage }
            finish(id: id, result: .failure(BackendInvocationError(
                code: .applicationError,
                message: message,
                applicationCode: code,
                details: details
            )))
        case let .event(name, payload):
            onEvent(.applicationEvent(name: name, payload: payload))
        }
    }

    private func finish(id: String, result: Result<Data, Error>) {
        guard let request = pending.removeValue(forKey: id) else { return }
        request.timeout.cancel()
        request.continuation.resume(with: result)
    }

    private func rejectPending(code: BackendBridgeErrorCode, message: String) {
        let requests = pending
        pending.removeAll()
        for request in requests.values {
            request.timeout.cancel()
            request.continuation.resume(throwing: BackendInvocationError(code: code, message: message))
        }
    }

    private func receiveStderr(_ data: Data) {
        guard !data.isEmpty else { return }
        recentError.append(data)
        if recentError.count > 64 * 1024 {
            recentError.removeFirst(recentError.count - 64 * 1024)
        }
        if let message = String(data: data, encoding: .utf8) {
            logger.info("\(message, privacy: .public)")
            if configuration.runtime.isDevelopment
                || ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1"
            {
                try? FileHandle.standardError.write(contentsOf: Data("fia-runtime: \(message)".utf8))
            }
        }
    }

    private func performInitialHealthProbe(origin: URL) {
        healthTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.checkHealth(origin: origin)
                self.diagnostic("authenticated health probe succeeded")
                guard !Task.isCancelled else { return }
                let token = try self.requiredBootstrapToken()
                let bootstrapURL = origin
                    .appendingPathComponent("__fia")
                    .appendingPathComponent("bootstrap")
                    .appendingPathComponent(token)
                self.onEvent(.ready(bootstrapURL: bootstrapURL))
                self.scheduleHealthChecks(origin: origin)
            } catch {
                self.fail(title: "Runtime health check failed", detail: error.localizedDescription)
            }
        }
    }

    private func requiredBootstrapToken() throws -> String {
        // The token is retained only long enough to build the one-time bootstrap URL.
        guard let token = bootstrapTokenForWebView else { throw RuntimeHealthError.missingBootstrapToken }
        bootstrapTokenForWebView = nil
        return token
    }

    private var bootstrapTokenForWebView: String?

    private func scheduleHealthChecks(origin: URL) {
        healthTask?.cancel()
        healthTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, let self else { return }
                do {
                    try await self.checkHealth(origin: origin)
                    self.healthFailures = 0
                } catch {
                    self.healthFailures += 1
                    if self.healthFailures >= 3 {
                        self.fail(
                            title: "Runtime is not responding",
                            detail: "Three consecutive authenticated health checks failed."
                        )
                        return
                    }
                }
            }
        }
    }

    private func checkHealth(origin: URL) async throws {
        guard let process, let controlToken else { throw RuntimeHealthError.notRunning }
        var request = URLRequest(url: origin.appendingPathComponent("__fia/health"))
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("Bearer \(controlToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw RuntimeHealthError.rejected
        }
        let health = try JSONDecoder().decode(HealthResponse.self, from: data)
        guard health.protocol == FIARuntimeProtocolVersion,
              health.status == "ok",
              health.pid == process.processIdentifier
        else { throw RuntimeHealthError.invalidResponse }
    }

    private func fail(title: String, detail: String) {
        guard !failureDelivered else { return }
        failureDelivered = true
        rejectPending(code: .backendUnavailable, message: detail)
        let log = String(data: recentError, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fullDetail = log?.isEmpty == false ? "\(detail)\n\nRecent runtime log:\n\(log!)" : detail
        diagnostic("failure: \(title): \(detail)")
        onEvent(.failed(title: title, detail: fullDetail))
        if process?.isRunning == true {
            stop {}
        }
    }

    private func processDidExit(status: Int32) {
        diagnostic("runtime process exited with status \(status)")
        gracefulWorkItem?.cancel()
        sigtermWorkItem?.cancel()
        gracefulWorkItem = nil
        sigtermWorkItem = nil
        startupTimeoutTask?.cancel()
        healthTask?.cancel()
        rejectPending(code: .backendUnavailable, message: "The Bun backend exited")
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
        process = nil
        removePIDFile()
        _ = lifecycle.processExited()

        let completions = stopCompletions
        stopCompletions.removeAll()
        completions.forEach { $0() }

        if !expectedExit && !failureDelivered {
            fail(title: "Runtime exited unexpectedly", detail: "Runtime exited with status \(status).")
        }
    }

    nonisolated private func enqueueProcessExit(status: Int32) {
        performSelector(
            onMainThread: #selector(deliverProcessExit(_:)),
            with: NSNumber(value: status),
            waitUntilDone: false,
            modes: [
                RunLoop.Mode.default.rawValue,
                RunLoop.Mode.common.rawValue,
                RunLoop.Mode.modalPanel.rawValue,
            ]
        )
    }

    @objc private func deliverProcessExit(_ value: NSNumber) {
        processDidExit(status: value.int32Value)
    }

    private func cleanDetachedPipes() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private enum RuntimeLocationError: Error, LocalizedError {
    case missingExecutable(String)
    case duplicateToken
    case invalidDevelopmentConfiguration
    case bundledRuntimeHasNoProcess

    var errorDescription: String? {
        switch self {
        case let .missingExecutable(path): "Runtime executable is missing or not executable at \(path)"
        case .duplicateToken: "Secure random generation returned duplicate tokens"
        case .invalidDevelopmentConfiguration: "Development runtime configuration is incomplete"
        case .bundledRuntimeHasNoProcess: "Bundled UI mode does not have a runtime process"
        }
    }
}

private enum RuntimeHealthError: Error, LocalizedError {
    case notRunning
    case rejected
    case invalidResponse
    case missingBootstrapToken

    var errorDescription: String? {
        switch self {
        case .notRunning: "Runtime is not running"
        case .rejected: "Runtime rejected the authenticated health request"
        case .invalidResponse: "Runtime returned an invalid health response"
        case .missingBootstrapToken: "Bootstrap token is unavailable"
        }
    }
}

private extension UInt8 {
    var isASCIIWhitespace: Bool {
        self == 0x09 || self == 0x0A || self == 0x0D || self == 0x20
    }
}

private final class RuntimeTerminator: @unchecked Sendable {
    private let process: Process
    private let pid: Int32

    init(process: Process, pid: Int32) {
        self.process = process
        self.pid = pid
    }

    func makeWorkItems() -> (graceful: DispatchWorkItem, force: DispatchWorkItem) {
        let force = DispatchWorkItem { [self] in
            guard process.isRunning, process.processIdentifier == pid else { return }
            diagnostic("SIGTERM timeout elapsed; sending SIGKILL")
            Darwin.kill(pid, SIGKILL)
        }
        let graceful = DispatchWorkItem { [self] in
            guard process.isRunning, process.processIdentifier == pid else { return }
            diagnostic("graceful timeout elapsed; sending SIGTERM")
            Darwin.kill(pid, SIGTERM)
            DispatchQueue.global(qos: .userInitiated).asyncAfter(
                deadline: .now() + 1,
                execute: force
            )
        }
        return (graceful, force)
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}
