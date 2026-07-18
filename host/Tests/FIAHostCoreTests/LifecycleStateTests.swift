import Testing
@testable import FIAHostCore

@Suite("Shutdown state machine")
struct LifecycleStateTests {
    @Test func escalatesAndCompletes() {
        var machine = ShutdownStateMachine()
        #expect(machine.requestStop() == .sendShutdown)
        #expect(machine.timeout() == .sendSIGTERM)
        #expect(machine.timeout() == .sendSIGKILL)
        #expect(machine.processExited() == .none)
    }

    @Test func exitCompletesEveryWaitingPhase() {
        var machine = ShutdownStateMachine()
        #expect(machine.requestStop() == .sendShutdown)
        #expect(machine.processExited() == .complete)
        #expect(machine.timeout() == .none)
    }
}

