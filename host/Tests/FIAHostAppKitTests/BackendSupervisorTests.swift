import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("Backend supervisor")
struct BackendSupervisorTests {
    @Test func staysReadyAfterCancellingReadinessTimeout() async throws {
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Ready", identifier: "com.example.ready"),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Ready"),
            backend: .init(
                executable: "/bin/sh",
                arguments: [
                    "-c",
                    #"IFS= read -r initialize; printf '%s\n' '{"v":1,"type":"ready","port":45678,"origin":"http://127.0.0.1:45678"}'; IFS= read -r shutdown"#,
                ],
                sha256: String(repeating: "0", count: 64)
            )
        )
        var states: [BackendSupervisor.State] = []
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in nil },
            onState: { states.append($0) }
        )
        supervisor.start()
        let readyDeadline = ContinuousClock.now + .seconds(2)
        while !states.contains(.ready(port: 45_678)), ContinuousClock.now < readyDeadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(states.contains(.ready(port: 45_678)))

        try await Task.sleep(for: .milliseconds(100))
        #expect(!states.contains(where: { if case .restarting = $0 { true } else { false } }))
        #expect(!states.contains(where: { if case .failed = $0 { true } else { false } }))

        #expect(supervisor.stop())
        let stoppedDeadline = ContinuousClock.now + .seconds(2)
        while !states.contains(.stopped), ContinuousClock.now < stoppedDeadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(states.contains(.stopped))
    }

    @Test func reportsCrashAndSchedulesRestart() async throws {
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Supervisor", identifier: "com.example.supervisor"),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Supervisor"),
            backend: .init(executable: "/usr/bin/false", sha256: String(repeating: "0", count: 64))
        )
        var states: [BackendSupervisor.State] = []
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in nil },
            onState: { states.append($0) }
        )
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !states.contains(where: { if case .restarting = $0 { true } else { false } }),
              ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(states.contains(where: { if case .starting = $0 { true } else { false } }))
        #expect(states.contains(where: { if case .restarting = $0 { true } else { false } }))
        supervisor.stop()
    }
}
