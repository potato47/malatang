import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("Backend supervisor")
struct BackendSupervisorTests {
    @Test func rejectsDuplicateRequestIDsAndConcurrencyOverflow() async throws {
        let duplicate = #"IFS= read -r initialize; printf '%s\n' '{"v":2,"type":"ready","port":45680,"origin":"http://127.0.0.1:45680"}'; printf '%s\n' '{"v":2,"type":"request","id":1,"method":"dialogs.openFile","params":{}}' '{"v":2,"type":"request","id":1,"method":"dialogs.openFile","params":{}}'; sleep 2"#
        try await expectProtocolRestart(script: duplicate, identifier: "com.example.duplicate")

        let overflow = #"IFS= read -r initialize; printf '%s\n' '{"v":2,"type":"ready","port":45681,"origin":"http://127.0.0.1:45681"}'; i=1; while [ "$i" -le 129 ]; do printf '{"v":2,"type":"request","id":%s,"method":"dialogs.openFile","params":{}}\n' "$i"; i=$((i + 1)); done; sleep 2"#
        try await expectProtocolRestart(script: overflow, identifier: "com.example.overflow")
    }

    @Test func cancelsAsyncRequestsAndAcknowledgesCancellation() async throws {
        let responseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-cancel-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: responseURL) }
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Cancellation", identifier: "com.example.cancellation"),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Cancellation"),
            backend: .init(
                executable: "/bin/sh",
                arguments: [
                    "-c",
                    #"IFS= read -r initialize; printf '%s\n' '{"v":2,"type":"ready","port":45679,"origin":"http://127.0.0.1:45679"}'; printf '%s\n' '{"v":2,"type":"request","id":7,"method":"dialogs.openFile","params":{}}'; sleep 0.05; printf '%s\n' '{"v":2,"type":"cancel","id":7}'; IFS= read -r response; printf '%s' "$response" > "$0"; sleep 2"#,
                    responseURL.path,
                ],
                sha256: String(repeating: "0", count: 64)
            )
        )
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in
                try await Task.sleep(for: .seconds(30))
                return nil
            },
            onState: { _ in }
        )
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !FileManager.default.fileExists(atPath: responseURL.path), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        let response = try String(contentsOf: responseURL, encoding: .utf8)
        #expect(response.contains(#""code":"CANCELLED""#))
        _ = supervisor.stop()
    }

    @Test func staysReadyAfterCancellingReadinessTimeout() async throws {
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Ready", identifier: "com.example.ready"),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Ready"),
            backend: .init(
                executable: "/bin/sh",
                arguments: [
                    "-c",
                    #"IFS= read -r initialize; printf '%s\n' '{"v":2,"type":"ready","port":45678,"origin":"http://127.0.0.1:45678"}'; IFS= read -r shutdown"#,
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

    private func expectProtocolRestart(script: String, identifier: String) async throws {
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Protocol", identifier: identifier),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Protocol"),
            backend: .init(
                executable: "/bin/sh",
                arguments: ["-c", script],
                sha256: String(repeating: "0", count: 64)
            )
        )
        var states: [BackendSupervisor.State] = []
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in
                try await Task.sleep(for: .seconds(30))
                return nil
            },
            onState: { states.append($0) }
        )
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !states.contains(where: { if case .restarting = $0 { true } else { false } }),
              ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(states.contains(where: { if case .restarting = $0 { true } else { false } }))
        _ = supervisor.stop()
    }
}
