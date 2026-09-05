import AppKit
import FIAUpdaterObjC
import Foundation

public enum UpdateState: Sendable, Equatable {
    case disabled
    case idle
    case checking
    case installing
    case failed(String)
}

@MainActor
public final class UpdateManager: NSObject {
    public private(set) var state: UpdateState = .disabled
    public var isEnabled: Bool { controller != nil }
    public var beforeInstall: (@MainActor () async throws -> Void)?

    var reportPreparationFailure: (Error) -> Void = { NSAlert(error: $0).runModal() }
    private var controller: Any?
    private var pendingRelaunch: (@MainActor () -> Void)?
    private var preparationTask: Task<Void, Never>?
    private var preparationGeneration = UUID()
    private var continuations: [UUID: AsyncStream<UpdateState>.Continuation] = [:]

    public override init() { super.init() }

    public func enable() {
        if NSClassFromString("SPUStandardUpdaterController") == nil,
           let framework = Bundle.main.privateFrameworksURL?.appending(path: "Sparkle.framework") {
            _ = Bundle(url: framework)?.load()
        }
        guard controller == nil, let type = NSClassFromString("SPUStandardUpdaterController") else { return }
        controller = FIASparkleMakeController(type, self)
        guard controller != nil else { return }
        transition(to: .idle)
    }

    public func checkForUpdates() throws {
        if pendingRelaunch != nil { prepareRelaunch(); return }
        guard let controller else { throw UpdateManagerError.disabled }
        transition(to: .checking)
        FIASparkleCheckForUpdates(controller)
    }

    public func states() -> AsyncStream<UpdateState> {
        let id = UUID()
        return AsyncStream { continuation in
            continuations[id] = continuation
            continuation.yield(state)
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.continuations.removeValue(forKey: id) }
            }
        }
    }

    @objc(updater:willInstallUpdate:)
    private func updaterWillInstall(_ updater: AnyObject, item: AnyObject) {
        transition(to: .installing)
    }

    @objc(updater:shouldPostponeRelaunchForUpdate:untilInvokingBlock:)
    private func updaterShouldPostponeRelaunch(
        _ updater: AnyObject,
        item: AnyObject,
        untilInvoking invocation: @escaping @convention(block) () -> Void
    ) -> Bool {
        postponeRelaunch { invocation() }
    }

    func postponeRelaunch(_ invocation: @escaping @MainActor () -> Void) -> Bool {
        guard beforeInstall != nil else { return false }
        if pendingRelaunch == nil { pendingRelaunch = invocation }
        prepareRelaunch()
        return true
    }

    private func prepareRelaunch() {
        guard preparationTask == nil, pendingRelaunch != nil, let beforeInstall else { return }
        transition(to: .installing)
        let generation = preparationGeneration
        preparationTask = Task { @MainActor in
            defer { self.preparationTask = nil }
            do {
                try await beforeInstall()
                guard generation == self.preparationGeneration else { return }
                let invocation = self.pendingRelaunch
                self.pendingRelaunch = nil
                invocation?()
            } catch {
                guard generation == self.preparationGeneration else { return }
                self.transition(to: .failed(error.localizedDescription))
                self.reportPreparationFailure(error)
            }
        }
    }

    @objc(updater:didAbortWithError:)
    private func updaterDidAbort(_ updater: AnyObject, error: NSError) {
        pendingRelaunch = nil
        preparationGeneration = UUID()
        transition(to: .failed(error.localizedDescription))
    }

    private func transition(to state: UpdateState) {
        self.state = state
        for continuation in continuations.values { continuation.yield(state) }
    }
}

public enum UpdateManagerError: Error, LocalizedError, Sendable {
    case disabled
    public var errorDescription: String? { "The updater is not configured for this application" }
}
