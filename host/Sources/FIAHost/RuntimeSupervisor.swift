import Darwin
import FIAHostCore
import Foundation
import OSLog

@MainActor
final class RuntimeSupervisor: NSObject {
    enum Event {
        case ready(bootstrapURL: URL)
        case failed(title: String, detail: String)
    }

    private struct HealthResponse: Decodable {
        let `protocol`: Int
        let status: String
        let pid: Int32
    }

    private let configuration: HostConfiguration
    private let bundle: Bundle
    private let onEvent: (Event) -> Void
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

    init(configuration: HostConfiguration, bundle: Bundle = .main, onEvent: @escaping (Event) -> Void) {
        self.configuration = configuration
        self.bundle = bundle
        self.onEvent = onEvent
        super.init()
    }

    var isRunning: Bool { process?.isRunning == true }

    func start() {
        guard process == nil else { return }
        resetRunState()

        do {
            let runtimeURL = try locateRuntime()
            let dataDirectory = try createDataDirectory()
            let bootstrapToken = try RuntimeProtocol.secureToken()
            let controlToken = try RuntimeProtocol.secureToken()
            guard bootstrapToken != controlToken else { throw RuntimeLocationError.duplicateToken }

            let process = Process()
            let input = Pipe()
            let output = Pipe()
            let error = Pipe()
            process.executableURL = runtimeURL
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
        stop { [weak self] in self?.start() }
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

    private func locateRuntime() throws -> URL {
        let url = bundle.bundleURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("MacOS", isDirectory: true)
            .appendingPathComponent("fia-runtime", isDirectory: false)
        guard FileManager.default.isExecutableFile(atPath: url.path) else {
            throw RuntimeLocationError.missingExecutable(url.path)
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
        if readyDelivered, data.contains(where: { !$0.isASCIIWhitespace }) {
            fail(title: "Runtime protocol error", detail: "Runtime emitted unexpected stdout data.")
            return
        }
        outputBuffer.append(data)
        guard outputBuffer.count <= FIAMaximumControlLineBytes else {
            fail(title: "Runtime protocol error", detail: RuntimeProtocolError.messageTooLarge.localizedDescription)
            return
        }
        guard let newline = outputBuffer.firstIndex(of: 0x0A) else { return }
        let line = outputBuffer[..<newline]
        let trailing = outputBuffer[outputBuffer.index(after: newline)...]
        guard !readyDelivered else {
            if trailing.contains(where: { !$0.isASCIIWhitespace }) {
                fail(title: "Runtime protocol error", detail: "Runtime emitted unexpected stdout data.")
            }
            return
        }

        do {
            guard let process else { return }
            let ready = try RuntimeProtocol.decodeReadyLine(Data(line), expectedPID: process.processIdentifier)
            diagnostic("runtime ready on port \(ready.port)")
            readyDelivered = true
            startupTimeoutTask?.cancel()
            outputBuffer = Data(trailing)
            let origin = URL(string: "http://127.0.0.1:\(ready.port)")!
            performInitialHealthProbe(origin: origin)
        } catch {
            fail(title: "Runtime protocol error", detail: error.localizedDescription)
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

    var errorDescription: String? {
        switch self {
        case let .missingExecutable(path): "Runtime executable is missing or not executable at \(path)"
        case .duplicateToken: "Secure random generation returned duplicate tokens"
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
