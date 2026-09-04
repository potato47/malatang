import FIACore
import Foundation
import Testing
@testable import FIAMacOS

@MainActor
@Suite("Backend supervisor")
struct BackendSupervisorTests {
    @Test func initializesBackendWithNativeResourceTransportCredentials() async throws {
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-initialize-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: output) }
        let nativeSession = String(repeating: "n", count: 64)
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Initialize",
            appIdentifier: "com.example.initialize",
            executable: "/bin/sh",
            arguments: [
                "-c",
                #"IFS= read -r initialize; printf '%s' "$initialize" > "$0"; IFS= read -r shutdown"#,
                output.path,
            ],
            sha256: String(repeating: "0", count: 64),
            nativeOrigin: "http://127.0.0.1:45670",
            nativeSession: nativeSession
        )
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in nil },
            onState: { _ in }
        )
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !FileManager.default.fileExists(atPath: output.path), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        let data = try Data(contentsOf: output)
        let frame = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(frame["nativeOrigin"] as? String == "http://127.0.0.1:45670")
        #expect(frame["nativeSession"] as? String == nativeSession)
        #expect((frame["sessionSecret"] as? String)?.count ?? 0 >= 64)
        _ = supervisor.stop()
    }

    @Test func rejectsDuplicateRequestIDsAndConcurrencyOverflow() async throws {
        let duplicate = #"IFS= read -r initialize; printf '%s\n' '{"v":3,"type":"ready","port":45680,"origin":"http://127.0.0.1:45680"}'; printf '%s\n' '{"v":3,"type":"request","id":1,"method":"dialogs.openFile","params":{}}' '{"v":3,"type":"request","id":1,"method":"dialogs.openFile","params":{}}'; sleep 2"#
        try await expectProtocolRestart(script: duplicate, identifier: "com.example.duplicate")

        let overflow = #"IFS= read -r initialize; printf '%s\n' '{"v":3,"type":"ready","port":45681,"origin":"http://127.0.0.1:45681"}'; i=1; while [ "$i" -le 129 ]; do printf '{"v":3,"type":"request","id":%s,"method":"dialogs.openFile","params":{}}\n' "$i"; i=$((i + 1)); done; sleep 2"#
        try await expectProtocolRestart(script: overflow, identifier: "com.example.overflow")
    }

    @Test func cancelsAsyncRequestsAndAcknowledgesCancellation() async throws {
        let responseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-cancel-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: responseURL) }
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Cancellation",
            appIdentifier: "com.example.cancellation",
            executable: "/bin/sh",
            arguments: [
                "-c",
                #"IFS= read -r initialize; printf '%s\n' '{"v":3,"type":"ready","port":45679,"origin":"http://127.0.0.1:45679"}'; printf '%s\n' '{"v":3,"type":"request","id":7,"method":"dialogs.openFile","params":{}}'; sleep 0.05; printf '%s\n' '{"v":3,"type":"cancel","id":7}'; IFS= read -r response; printf '%s' "$response" > "$0"; sleep 2"#,
                responseURL.path,
            ],
            sha256: String(repeating: "0", count: 64),
            nativeOrigin: "http://127.0.0.1:45670",
            nativeSession: String(repeating: "n", count: 64)
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
        #expect(response.contains(#""code":"cancelled""#))
        _ = supervisor.stop()
    }

    @Test func staysReadyAfterCancellingReadinessTimeout() async throws {
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Ready",
            appIdentifier: "com.example.ready",
            executable: "/bin/sh",
            arguments: [
                "-c",
                #"IFS= read -r initialize; printf '%s\n' '{"v":3,"type":"ready","port":45678,"origin":"http://127.0.0.1:45678"}'; IFS= read -r shutdown"#,
            ],
            sha256: String(repeating: "0", count: 64),
            nativeOrigin: "http://127.0.0.1:45670",
            nativeSession: String(repeating: "n", count: 64)
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
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Supervisor",
            appIdentifier: "com.example.supervisor",
            executable: "/usr/bin/false",
            sha256: String(repeating: "0", count: 64),
            nativeOrigin: "http://127.0.0.1:45670",
            nativeSession: String(repeating: "n", count: 64)
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
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Protocol",
            appIdentifier: identifier,
            executable: "/bin/sh",
            arguments: ["-c", script],
            sha256: String(repeating: "0", count: 64),
            nativeOrigin: "http://127.0.0.1:45670",
            nativeSession: String(repeating: "n", count: 64)
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
