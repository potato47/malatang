import Foundation

public enum RuntimeLifecycle: String, Sendable { case running, shuttingDown, stopped }
public enum ShutdownReason: String, Sendable { case quit, update }
public struct ShutdownIssue: Sendable, Equatable {
    public let name: String
    public let message: String
}
public struct ShutdownReport: Sendable {
    public let reason: ShutdownReason
    public let issues: [ShutdownIssue]
    public let completed: Bool
}

@MainActor
final class ShutdownRace {
    private var continuation: CheckedContinuation<ShutdownIssue?, Never>?
    private var work: Task<Void, Never>?
    private var timer: Task<Void, Never>?

    func run(name: String, timeout: Duration, handler: @escaping @MainActor () async throws -> Void) async
        -> ShutdownIssue?
    {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            work = Task { @MainActor in
                do {
                    try await handler()
                    self.finish(nil)
                } catch { self.finish(ShutdownIssue(name: name, message: error.localizedDescription)) }
            }
            timer = Task { @MainActor in
                do { try await Task.sleep(for: timeout) } catch { return }
                self.work?.cancel()
                self.finish(ShutdownIssue(name: name, message: "Cleanup timed out"))
            }
        }
    }

    private func finish(_ issue: ShutdownIssue?) {
        guard let continuation else { return }
        self.continuation = nil
        timer?.cancel()
        timer = nil
        work = nil
        continuation.resume(returning: issue)
    }
}
