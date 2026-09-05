import Darwin
import FIAProcessSupport
import Foundation

public struct ManagedProcessError: Error, LocalizedError, Sendable {
    public let message: String
    public var errorDescription: String? { message }
    public init(_ message: String) { self.message = message }
}

/// Serial, bounded stdin queue. Nonblocking descriptors let cancellation interrupt
/// pipe backpressure without closing/reusing a descriptor beneath an active write.
private final class ProcessInput: @unchecked Sendable {
    private let descriptor: Int32
    private let queue = DispatchQueue(label: "fia.process.stdin")
    private let lock = NSLock()
    private var closed = false
    private var queuedBytes = 0
    private let onFailure: @Sendable (ManagedProcessError) -> Void

    init(descriptor: Int32, onFailure: @escaping @Sendable (ManagedProcessError) -> Void) {
        self.descriptor = descriptor
        self.onFailure = onFailure
    }
    deinit { Darwin.close(descriptor) }
    func close() { lock.withLock { closed = true } }

    func enqueue(_ data: Data) throws {
        try lock.withLock {
            guard !closed else { throw ManagedProcessError("Process stdin is closed") }
            guard data.count <= 4_194_304 - queuedBytes else {
                throw ManagedProcessError("Process stdin queue exceeds 4 MiB")
            }
            queuedBytes += data.count
        }
        queue.async { [self] in
            defer { lock.withLock { queuedBytes -= data.count } }
            data.withUnsafeBytes { bytes in
                var offset = 0
                while offset < bytes.count, !lock.withLock({ closed }) {
                    let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                    if count > 0 {
                        offset += count
                        continue
                    }
                    if count < 0, errno == EINTR { continue }
                    if count < 0, errno == EAGAIN || errno == EWOULDBLOCK {
                        var event = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
                        _ = Darwin.poll(&event, 1, 100)
                        continue
                    }
                    let error = ManagedProcessError("Process stdin write: \(String(cString: strerror(errno)))")
                    close()
                    onFailure(error)
                    return
                }
            }
        }
    }
}

/// One launch and its process group. Create a new instance to start again.
@MainActor
public final class ManagedProcess {
    public enum Channel: Sendable { case stdout, stderr }
    public struct Output: Sendable {
        public let channel: Channel
        public let data: Data
    }
    public struct StopPolicy: Sendable {
        public var graceful: Duration
        public var terminate: Duration
        public var kill: Duration
        public init(graceful: Duration = .seconds(5), terminate: Duration = .seconds(2), kill: Duration = .seconds(2)) {
            self.graceful = graceful
            self.terminate = terminate
            self.kill = kill
        }
    }

    public let generation = UUID()
    public private(set) var processIdentifier: Int32 = 0
    public private(set) var terminationStatus: Int32?
    public private(set) var stdout = Data()
    public private(set) var stderr = Data()
    public var isRunning: Bool { processIdentifier > 0 && terminationStatus == nil }
    /// Ordered, lossless callback, separate from the bounded diagnostic stream.
    public var onOutput: (@MainActor (Output) -> Void)?
    public var onInputError: (@MainActor (ManagedProcessError) -> Void)?
    public var onExit: (@MainActor (Int32) -> Void)?
    private let executable: URL
    private let arguments: [String]
    private let workingDirectory: URL
    private let environment: [String: String]
    private let logLimit: Int
    private var identity: UInt64 = 0
    var groupState: (Int32, UInt64) -> Int32 = fia_group_state
    var signalGroup: (Int32, UInt64, Int32) -> Int32 = fia_signal_group
    private var input: ProcessInput?
    private var stopTask: Task<Void, Error>?
    private var openOutputs = 2
    private var streams: [UUID: AsyncStream<Output>.Continuation] = [:]

    public init(
        executable: URL, arguments: [String] = [],
        workingDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        environment: [String: String] = ProcessInfo.processInfo.environment, logLimit: Int = 1_048_576
    ) {
        self.executable = executable
        self.arguments = arguments
        self.workingDirectory = workingDirectory
        self.environment = environment
        self.logLimit = max(0, logLimit)
    }

    public func output() -> AsyncStream<Output> {
        let id = UUID()
        return AsyncStream(bufferingPolicy: .bufferingNewest(128)) { continuation in
            if terminationStatus != nil && openOutputs == 0 {
                continuation.finish()
                return
            }
            streams[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.streams.removeValue(forKey: id) }
            }
        }
    }

    public func start() throws {
        guard processIdentifier == 0 else { throw ManagedProcessError("ManagedProcess instances can only launch once") }
        let argv = ([executable.path] + arguments).map { strdup($0) } + [nil]
        let env = environment.sorted { $0.key < $1.key }.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { for p in argv + env { free(p) } }
        var pid: Int32 = 0
        var inputFD: Int32 = -1
        var outputFD: Int32 = -1
        var errorFD: Int32 = -1
        let result = fia_spawn(executable.path, argv, env, workingDirectory.path, &pid, &inputFD, &outputFD, &errorFD)
        guard result == 0 else { throw ManagedProcessError("posix_spawn: \(String(cString: strerror(result)))") }
        processIdentifier = pid
        // Read identity before reaping even an immediately exiting child.
        identity = fia_process_identity(pid)
        input = ProcessInput(descriptor: inputFD) { [weak self] error in
            Task { @MainActor in self?.onInputError?(error) }
        }
        drain(outputFD, channel: .stdout)
        drain(errorFD, channel: .stderr)
        let launchedPID = pid
        DispatchQueue.global().async { [self] in
            let status = fia_wait(launchedPID)
            Task { @MainActor in
                terminationStatus = status
                input?.close()
                input = nil
                finishStreamsIfDone()
                onExit?(status)
            }
        }
    }

    /// Enqueues an entire chunk atomically; at most 4 MiB may be queued.
    /// OS write failures are delivered through onInputError, without blocking MainActor.
    public func write(_ data: Data) throws {
        guard isRunning, let input else { throw ManagedProcessError("Process stdin is closed") }
        try input.enqueue(data)
    }

    public func stop(policy: StopPolicy = .init(), gracefulShutdown: (@MainActor () -> Void)? = nil) async throws {
        if let stopTask { return try await stopTask.value }
        let task = Task { @MainActor in
            guard self.processIdentifier > 0 else { return }
            gracefulShutdown?()
            if try await self.waitForGroup(policy.graceful) { return }
            try self.signal(SIGTERM)
            if try await self.waitForGroup(policy.terminate) { return }
            try self.signal(SIGKILL)
            guard try await self.waitForGroup(policy.kill) else {
                throw ManagedProcessError("Process group \(self.processIdentifier) did not exit after SIGKILL")
            }
        }
        stopTask = task
        do { try await task.value } catch {
            stopTask = nil
            throw error
        }
    }

    private func signal(_ signal: Int32) throws {
        let result = signalGroup(processIdentifier, identity, signal)
        guard result == 0 else {
            throw ManagedProcessError(
                "Cannot signal owned process group \(processIdentifier): \(String(cString: strerror(result)))")
        }
    }

    private func waitForGroup(_ duration: Duration) async throws -> Bool {
        let deadline = ContinuousClock.now + duration
        repeat {
            let state = groupState(processIdentifier, identity)
            if state == 0, terminationStatus != nil { return true }
            if ContinuousClock.now >= deadline {
                if state < 0 {
                    throw ManagedProcessError("Cannot establish process group ownership for \(processIdentifier)")
                }
                return false
            }
            try await Task.sleep(for: .milliseconds(20))
        } while true
    }

    private func finishStreamsIfDone() {
        if terminationStatus != nil, openOutputs == 0 {
            for stream in streams.values { stream.finish() }
            streams.removeAll()
        }
    }

    private func drain(_ descriptor: Int32, channel: Channel) {
        // Blocking reads stay off MainActor. Synchronous delivery applies pipe backpressure,
        // preventing an unbounded queue while preserving protocol byte ordering.
        DispatchQueue.global().async { [weak self] in
            defer { Darwin.close(descriptor) }
            var buffer = [UInt8](repeating: 0, count: 16_384)
            while true {
                let count = Darwin.read(descriptor, &buffer, buffer.count)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { break }
                let data = Data(buffer.prefix(count))
                DispatchQueue.main.sync {
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        let output = Output(channel: channel, data: data)
                        switch channel {
                        case .stdout:
                            self.stdout.append(data)
                            self.stdout = self.stdout.suffix(self.logLimit)
                        case .stderr:
                            self.stderr.append(data)
                            self.stderr = self.stderr.suffix(self.logLimit)
                        }
                        self.onOutput?(output)
                        for stream in self.streams.values { stream.yield(output) }
                    }
                }
            }
            DispatchQueue.main.sync {
                MainActor.assumeIsolated {
                    self?.openOutputs -= 1
                    self?.finishStreamsIfDone()
                }
            }
        }
    }
}
