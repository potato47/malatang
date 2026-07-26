import Darwin
import FIAHostCore
import Foundation
import OSLog

struct BackendInvocationError: Error, LocalizedError {
    let code: BackendBridgeErrorCode
    let message: String
    let applicationCode: String?
    let details: Data?

    init(
        code: BackendBridgeErrorCode,
        message: String,
        applicationCode: String? = nil,
        details: Data? = nil
    ) {
        self.code = code
        self.message = message
        self.applicationCode = applicationCode
        self.details = details
    }

    var errorDescription: String? { message }
}

@MainActor
final class BackendSupervisor: NSObject {
    enum Event {
        case ready
        case applicationEvent(name: String, payload: Data)
        case failed(title: String, detail: String)
    }

    private struct PendingRequest {
        let continuation: CheckedContinuation<Data, Error>
        let timeout: Task<Void, Never>
    }

    private let configuration: HostConfiguration
    private let bundle: Bundle
    private let onEvent: (Event) -> Void
    private let requestTimeout: Duration
    private let startupTimeout: Duration
    private let logger = Logger(subsystem: "dev.fia.host", category: "backend")

    private var process: Process?
    private var activeRunID: UUID?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?
    private var errorPipe: Pipe?
    private var outputBuffer = Data()
    private var recentError = Data()
    private var lifecycle = ShutdownStateMachine()
    private var startupTimeoutTask: Task<Void, Never>?
    private var gracefulWorkItem: DispatchWorkItem?
    private var sigtermWorkItem: DispatchWorkItem?
    private var stopCompletions: [() -> Void] = []
    private var pending: [String: PendingRequest] = [:]
    private var expectedExit = false
    private var failureDelivered = false
    private var readyDelivered = false

    init(
        configuration: HostConfiguration,
        bundle: Bundle = .main,
        requestTimeout: Duration = .seconds(30),
        startupTimeout: Duration = .seconds(10),
        onEvent: @escaping (Event) -> Void
    ) {
        self.configuration = configuration
        self.bundle = bundle
        self.requestTimeout = requestTimeout
        self.startupTimeout = startupTimeout
        self.onEvent = onEvent
        super.init()
    }

    var isRunning: Bool { process?.isRunning == true }
    var isReady: Bool { readyDelivered && isRunning }
    var processIdentifier: Int32? { process?.processIdentifier }

    func start() {
        guard process == nil, configuration.backend.isEnabled else { return }
        resetRunState()
        do {
            let executable = try locateBackend()
            let dataDirectory = try createDataDirectory()
            let runID = UUID()
            let process = Process()
            let input = Pipe()
            let output = Pipe()
            let error = Pipe()
            process.executableURL = executable
            process.currentDirectoryURL = dataDirectory
            process.standardInput = input
            process.standardOutput = output
            process.standardError = error
            process.terminationHandler = { [weak self] terminated in
                self?.enqueueProcessExit(status: terminated.terminationStatus, runID: runID)
            }
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                Task { @MainActor [weak self] in self?.receiveStdout(data, runID: runID) }
            }
            error.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                Task { @MainActor [weak self] in self?.receiveStderr(data, runID: runID) }
            }
            try process.run()
            self.process = process
            activeRunID = runID
            inputPipe = input
            outputPipe = output
            errorPipe = error
            try input.fileHandleForWriting.write(contentsOf: BackendProcessProtocol.encodeInitialize(
                parentPid: getpid(),
                dataDirectory: dataDirectory.path
            ))
            let startupTimeout = self.startupTimeout
            startupTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: startupTimeout)
                guard !Task.isCancelled else { return }
                self?.fail(
                    title: "Swift backend startup timed out",
                    detail: "No valid ready message arrived within 10 seconds."
                )
            }
            diagnostic("Swift backend launched with pid \(process.processIdentifier)")
        } catch {
            cleanDetachedPipes()
            fail(title: "Swift backend could not start", detail: error.localizedDescription)
        }
    }

    func invoke(_ request: BackendBridgeRequest) async throws -> Data {
        guard isReady, let inputPipe else {
            throw BackendInvocationError(
                code: .backendUnavailable,
                message: "The FIA Swift backend is unavailable"
            )
        }
        guard pending.count < FIABackendMaximumConcurrentRequests else {
            throw BackendInvocationError(
                code: .backendUnavailable,
                message: "The Swift backend has too many in-flight requests"
            )
        }
        let id = UUID().uuidString.lowercased()
        let requestTimeout = self.requestTimeout
        return try await withCheckedThrowingContinuation { continuation in
            let timeout = Task { @MainActor [weak self] in
                try? await Task.sleep(for: requestTimeout)
                guard !Task.isCancelled else { return }
                self?.finish(
                    id: id,
                    result: .failure(BackendInvocationError(
                        code: .backendTimeout,
                        message: "The Swift backend request timed out"
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
                    message: "The Swift backend request could not be sent"
                )))
            }
        }
    }

    func restart() {
        rejectPending(code: .backendRestarted, message: "The Swift backend restarted")
        stop { [weak self] in self?.start() }
    }

    func stop(completion: @escaping () -> Void) {
        guard let process else {
            completion()
            return
        }
        stopCompletions.append(completion)
        guard lifecycle.requestStop() == .sendShutdown else { return }
        expectedExit = true
        startupTimeoutTask?.cancel()
        rejectPending(code: .backendUnavailable, message: "The Swift backend stopped")
        do {
            try inputPipe?.fileHandleForWriting.write(contentsOf: BackendProcessProtocol.encodeShutdown())
            try inputPipe?.fileHandleForWriting.close()
        } catch {
            logger.error("Could not stop Swift backend gracefully: \(error.localizedDescription, privacy: .public)")
        }
        let terminator = BackendTerminator(process: process, pid: process.processIdentifier)
        let workItems = terminator.makeWorkItems()
        gracefulWorkItem = workItems.graceful
        sigtermWorkItem = workItems.force
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2, execute: workItems.graceful)
    }

    func forceStop() {
        guard let process, process.isRunning else { return }
        expectedExit = true
        Darwin.kill(process.processIdentifier, SIGKILL)
    }

    private func locateBackend() throws -> URL {
        let url: URL
        switch configuration.backend.mode {
        case .none, .runtime:
            throw BackendLocationError.disabled
        case .production:
            url = bundle.bundleURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("MacOS", isDirectory: true)
                .appendingPathComponent("fia-backend", isDirectory: false)
        case .development:
            guard let executable = configuration.backend.executable else {
                throw BackendLocationError.invalidDevelopmentConfiguration
            }
            url = URL(fileURLWithPath: executable, isDirectory: false)
        }
        guard FileManager.default.isExecutableFile(atPath: url.path) else {
            throw BackendLocationError.missingExecutable(url.path)
        }
        return url
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

    private func resetRunState() {
        outputBuffer.removeAll(keepingCapacity: true)
        recentError.removeAll(keepingCapacity: true)
        lifecycle = ShutdownStateMachine()
        expectedExit = false
        failureDelivered = false
        readyDelivered = false
        gracefulWorkItem?.cancel()
        sigtermWorkItem?.cancel()
        gracefulWorkItem = nil
        sigtermWorkItem = nil
    }

    private func receiveStdout(_ data: Data, runID: UUID) {
        guard runID == activeRunID else { return }
        guard !data.isEmpty else {
            if !expectedExit, process?.isRunning == true {
                fail(title: "Swift backend protocol error", detail: "The backend closed stdout unexpectedly.")
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
                try receive(BackendProcessProtocol.decodeLine(line, expectedPID: process.processIdentifier))
            } catch {
                fail(title: "Swift backend protocol error", detail: error.localizedDescription)
                return
            }
        }
        guard outputBuffer.count <= FIABackendMaximumMessageBytes else {
            fail(title: "Swift backend protocol error", detail: BackendProtocolError.messageTooLarge.localizedDescription)
            return
        }
    }

    private func receive(_ message: BackendProcessMessage) throws {
        switch message {
        case .ready:
            guard !readyDelivered, pending.isEmpty else { throw BackendProtocolError.invalidMessage }
            readyDelivered = true
            startupTimeoutTask?.cancel()
            diagnostic("Swift backend ready")
            onEvent(.ready)
        case let .success(id, value):
            guard readyDelivered, pending[id] != nil else { throw BackendProtocolError.invalidMessage }
            finish(id: id, result: .success(value))
        case let .failure(id, code, message, details):
            guard readyDelivered, pending[id] != nil else { throw BackendProtocolError.invalidMessage }
            finish(id: id, result: .failure(BackendInvocationError(
                code: .applicationError,
                message: message,
                applicationCode: code,
                details: details
            )))
        case let .event(name, payload):
            guard readyDelivered else { throw BackendProtocolError.invalidMessage }
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

    private func receiveStderr(_ data: Data, runID: UUID) {
        guard runID == activeRunID else { return }
        guard !data.isEmpty else { return }
        recentError.append(data)
        if recentError.count > 64 * 1024 { recentError.removeFirst(recentError.count - 64 * 1024) }
        if let message = String(data: data, encoding: .utf8) {
            logger.info("\(message, privacy: .public)")
            if configuration.backend.isDevelopment
                || ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1"
            {
                try? FileHandle.standardError.write(contentsOf: Data("fia-backend: \(message)".utf8))
            }
        }
    }

    private func fail(title: String, detail: String) {
        guard !failureDelivered else { return }
        failureDelivered = true
        rejectPending(code: .backendUnavailable, message: detail)
        let log = String(data: recentError, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fullDetail = log?.isEmpty == false ? "\(detail)\n\nRecent backend log:\n\(log!)" : detail
        onEvent(.failed(title: title, detail: fullDetail))
        if process?.isRunning == true { stop {} }
    }

    private func processDidExit(status: Int32, runID: UUID) {
        guard runID == activeRunID else { return }
        let shouldReportFailure = !expectedExit && !failureDelivered
        gracefulWorkItem?.cancel()
        sigtermWorkItem?.cancel()
        startupTimeoutTask?.cancel()
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
        process = nil
        activeRunID = nil
        readyDelivered = false
        _ = lifecycle.processExited()
        rejectPending(code: .backendUnavailable, message: "The Swift backend exited")
        let completions = stopCompletions
        stopCompletions.removeAll()
        completions.forEach { $0() }
        if shouldReportFailure {
            fail(title: "Swift backend exited unexpectedly", detail: "Backend exited with status \(status).")
        }
    }

    nonisolated private func enqueueProcessExit(status: Int32, runID: UUID) {
        performSelector(
            onMainThread: #selector(deliverProcessExit(_:)),
            with: BackendExitDelivery(status: status, runID: runID),
            waitUntilDone: false,
            modes: [RunLoop.Mode.default.rawValue, RunLoop.Mode.common.rawValue, RunLoop.Mode.modalPanel.rawValue]
        )
    }

    @objc private func deliverProcessExit(_ value: BackendExitDelivery) {
        processDidExit(status: value.status, runID: value.runID)
    }

    private func cleanDetachedPipes() {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        errorPipe?.fileHandleForReading.readabilityHandler = nil
        inputPipe = nil
        outputPipe = nil
        errorPipe = nil
        activeRunID = nil
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private final class BackendExitDelivery: NSObject, @unchecked Sendable {
    let status: Int32
    let runID: UUID

    init(status: Int32, runID: UUID) {
        self.status = status
        self.runID = runID
    }
}

private enum BackendLocationError: Error, LocalizedError {
    case disabled
    case invalidDevelopmentConfiguration
    case missingExecutable(String)

    var errorDescription: String? {
        switch self {
        case .disabled: "Swift backend is disabled"
        case .invalidDevelopmentConfiguration: "Development Swift backend configuration is incomplete"
        case let .missingExecutable(path): "Swift backend is missing or not executable at \(path)"
        }
    }
}

private final class BackendTerminator: @unchecked Sendable {
    private let process: Process
    private let pid: Int32

    init(process: Process, pid: Int32) {
        self.process = process
        self.pid = pid
    }

    func makeWorkItems() -> (graceful: DispatchWorkItem, force: DispatchWorkItem) {
        let force = DispatchWorkItem { [self] in
            guard process.isRunning, process.processIdentifier == pid else { return }
            Darwin.kill(pid, SIGKILL)
        }
        let graceful = DispatchWorkItem { [self] in
            guard process.isRunning, process.processIdentifier == pid else { return }
            Darwin.kill(pid, SIGTERM)
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 2, execute: force)
        }
        return (graceful, force)
    }
}
