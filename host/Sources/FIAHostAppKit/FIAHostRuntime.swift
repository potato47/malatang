import AppKit
import FIAHostCore
import Foundation

public enum FIAHostCapabilityResult {
    case unhandled
    case handled(Any?)
}

@MainActor
public protocol FIAHostCapabilityProvider {
    func handle(method: String, params: [String: Any]) async throws -> FIAHostCapabilityResult
}

public enum FIAHostRuntimeState: Equatable, Sendable {
    case idle
    case starting
    case ready(port: Int)
    case restarting(attempt: Int)
    case failed(reason: String)
    case stopping
    case stopped
}

public enum FIAHostTerminationDisposition: Equatable, Sendable {
    case terminateNow
    case waitForBackend
}

@MainActor
public final class FIAHostRuntime {
    public private(set) var state: FIAHostRuntimeState = .idle
    public var onStateChange: ((FIAHostRuntimeState) -> Void)?
    public var onTerminationReady: (() -> Void)?

    private let hostController: HostController
    private let supervisor: BackendSupervisor
    private let bridge: FIAHostRuntimeBridge
    private var terminationPending = false

    public convenience init(
        configurationURL: URL,
        applicationSupportDirectory: URL? = nil,
        windowFactory: any FIAHostWindowFactory = FIADefaultHostWindowFactory(),
        capabilityProvider: (any FIAHostCapabilityProvider)? = nil
    ) throws {
        try self.init(
            configuration: HostConfiguration.load(from: configurationURL),
            applicationSupportDirectory: applicationSupportDirectory,
            windowFactory: windowFactory,
            capabilityProvider: capabilityProvider
        )
    }

    public init(
        configuration: HostConfiguration,
        applicationSupportDirectory: URL? = nil,
        windowFactory: any FIAHostWindowFactory = FIADefaultHostWindowFactory(),
        capabilityProvider: (any FIAHostCapabilityProvider)? = nil
    ) throws {
        let bridge = FIAHostRuntimeBridge()
        self.bridge = bridge
        let settingsStore = try? HostSettingsStore(
            identifier: configuration.app.identifier,
            applicationSupportDirectory: applicationSupportDirectory,
            diagnostic: { message in Self.diagnostic(message) }
        )
        let backendDirectory = try BackendSupervisor.workingDirectory(
            configuration: configuration,
            applicationSupportDirectory: applicationSupportDirectory
        )
        let hostController = HostController(
            configuration: configuration,
            backendDirectory: backendDirectory,
            settingsStore: settingsStore,
            windowFactory: windowFactory,
            capabilityProvider: capabilityProvider
        )
        self.hostController = hostController
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: applicationSupportDirectory,
            onRequest: { [weak hostController] method, params in
                guard let hostController else {
                    throw HostRequestExecutionError(
                        code: .nativeFailure,
                        message: "Host controller is unavailable"
                    )
                }
                return try await hostController.execute(method: method, params: params)
            },
            onState: { [weak bridge] state in bridge?.runtime?.backendStateChanged(state) }
        )
        self.supervisor = supervisor
        hostController.onEvent = { [weak supervisor] event, payload in
            supervisor?.sendEvent(event, payload: payload)
        }
        hostController.onRetry = { [weak supervisor] in supervisor?.retry() }
        bridge.runtime = self
    }

    public func start() {
        guard state == .idle else { return }
        hostController.start()
        supervisor.start()
    }

    public func retry() {
        supervisor.retry()
    }

    public func sendEvent(_ event: String, payload: Any? = nil) {
        supervisor.sendEvent(event, payload: payload)
    }

    public func applicationReopened() {
        hostController.applicationReopened()
    }

    public func prepareForTermination() -> FIAHostTerminationDisposition {
        hostController.flushSettings()
        guard !terminationPending else { return .waitForBackend }
        guard state != .idle, supervisor.stop() else { return .terminateNow }
        terminationPending = true
        return .waitForBackend
    }

    public func applicationWillTerminate() {
        hostController.flushSettings()
        hostController.clearBackendResources()
    }

    func emitStatusItemActionForDevelopment(id: String) throws {
        try hostController.emitStatusItemActionForDevelopment(id: id)
    }

    private func backendStateChanged(_ backendState: BackendSupervisor.State) {
        let nextState: FIAHostRuntimeState
        switch backendState {
        case .starting:
            hostController.showStarting()
            nextState = .starting
        case let .restarting(attempt):
            hostController.showStarting()
            nextState = .restarting(attempt: attempt)
        case let .ready(port):
            hostController.showReady()
            nextState = .ready(port: port)
        case let .failed(reason):
            hostController.showFailure(reason)
            nextState = .failed(reason: reason)
        case .stopping:
            hostController.clearBackendResources()
            nextState = .stopping
        case .stopped:
            hostController.clearBackendResources()
            nextState = .stopped
        }
        transition(to: nextState)
        if backendState == .stopped, terminationPending {
            terminationPending = false
            onTerminationReady?()
        }
    }

    private func transition(to nextState: FIAHostRuntimeState) {
        guard state != nextState else { return }
        state = nextState
        onStateChange?(nextState)
    }

    private static func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

@MainActor
private final class FIAHostRuntimeBridge {
    weak var runtime: FIAHostRuntime?
}
