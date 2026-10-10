import FIACore
import Foundation
import Testing
@testable import FIAMacOS

@MainActor
@Suite("Backend supervisor")
struct BackendSupervisorTests {
    @Test(arguments: [false, true]) func startupWaitsForNativeInteractionThenReceivesReady(denied: Bool) async throws {
        let configuration = FIABunConfiguration(
            development: true, appName: "Interaction", appIdentifier: "com.example.interaction.\(UUID().uuidString)",
            executable: "/bin/sh",
            arguments: ["-c", #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"request","id":1,"method":"keychain.get","params":{}}'; IFS= read -r response; printf '%s\n' '{"v":5,"type":"ready","port":45683,"origin":"http://127.0.0.1:45683"}'; IFS= read -r shutdown"#],
            sha256: String(repeating: "0", count: 64), sessionSecret: String(repeating: "n", count: 64),
            webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1, automaticallyRestart: false
        )
        var states: [BackendSupervisor.State] = []
        var releaseNative = false
        let supervisor = try BackendSupervisor(
            configuration: configuration, applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in
                while !releaseNative { try await Task.sleep(for: .milliseconds(20)) }
                if denied { throw FIAError(code: .nativeFailure, component: "keychain", message: "Denied") }
                return nil
            }, onState: { states.append($0) }
        )
        supervisor.readinessTimeout = .milliseconds(150)
        supervisor.start()
        let nativeDeadline = ContinuousClock.now + .seconds(2)
        while !supervisor.waitingOnNative, ContinuousClock.now < nativeDeadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(supervisor.waitingOnNative)
        // Keep the native response pending beyond the readiness timeout.
        try await Task.sleep(for: .milliseconds(200))
        #expect(supervisor.waitingOnNative)
        #expect(!states.contains(where: { if case .failed = $0 { true } else { false } }))
        releaseNative = true
        let deadline = ContinuousClock.now + .seconds(2)
        while !states.contains(.ready(port: 45_683)), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(states.contains(.ready(port: 45_683)))
        #expect(!supervisor.waitingOnNative)
        #expect(!states.contains(where: { if case .failed = $0 { true } else { false } }))
        try await supervisor.stop()
    }

    @Test(arguments: [false, true]) func startupTimeoutResumesAfterNativeReturnOrCancellation(cancelled: Bool) async throws {
        let script = cancelled
            ? #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"request","id":1,"method":"keychain.get","params":{}}'; sleep 0.3; printf '%s\n' '{"v":5,"type":"cancel","id":1}'; IFS= read -r response; IFS= read -r shutdown"#
            : #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"request","id":1,"method":"keychain.get","params":{}}'; IFS= read -r response; IFS= read -r shutdown"#
        let configuration = FIABunConfiguration(
            development: true, appName: "Stalled", appIdentifier: "com.example.stalled.\(UUID().uuidString)",
            executable: "/bin/sh", arguments: ["-c", script],
            sha256: String(repeating: "0", count: 64), sessionSecret: String(repeating: "n", count: 64),
            webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1, automaticallyRestart: false
        )
        var failed = false
        var finishedNative = false
        let supervisor = try BackendSupervisor(
            configuration: configuration, applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { _, _ in
                defer { finishedNative = true }
                try await Task.sleep(for: cancelled ? .seconds(30) : .milliseconds(400))
                return nil
            }, onState: { if case .failed = $0 { failed = true } }
        )
        supervisor.readinessTimeout = .milliseconds(150)
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !failed, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(finishedNative)
        #expect(failed)
        try await supervisor.stop()
    }

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
            sessionSecret: nativeSession, webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
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
        #expect(frame["webRoot"] as? String == "/tmp/web")
        #expect(frame["resourceDirectory"] as? String == "/tmp/resources")
        #expect((frame["sessionSecret"] as? String)?.count ?? 0 >= 64)
        try await supervisor.stop()
    }

    @Test func rejectsDuplicateRequestIDsAndConcurrencyOverflow() async throws {
        let duplicate = #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45680,"origin":"http://127.0.0.1:45680"}'; printf '%s\n' '{"v":5,"type":"request","id":1,"method":"dialogs.openFile","params":{}}' '{"v":5,"type":"request","id":1,"method":"dialogs.openFile","params":{}}'; sleep 2"#
        try await expectProtocolRestart(script: duplicate, identifier: "com.example.duplicate")

        let overflow = #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45681,"origin":"http://127.0.0.1:45681"}'; i=1; while [ "$i" -le 129 ]; do printf '{"v":5,"type":"request","id":%s,"method":"dialogs.openFile","params":{}}\n' "$i"; i=$((i + 1)); done; sleep 2"#
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
                #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45679,"origin":"http://127.0.0.1:45679"}'; printf '%s\n' '{"v":5,"type":"request","id":7,"method":"dialogs.openFile","params":{}}'; sleep 0.05; printf '%s\n' '{"v":5,"type":"cancel","id":7}'; IFS= read -r response; printf '%s' "$response" > "$0"; sleep 2"#,
                responseURL.path,
            ],
            sha256: String(repeating: "0", count: 64),
            sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
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
        try await supervisor.stop()
    }

    @Test func roundTripsTopLevelJSONFragments() async throws {
        let responseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-fragment-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: responseURL) }
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Fragments",
            appIdentifier: "com.example.fragments",
            executable: "/bin/sh",
            arguments: [
                "-c",
                #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45682,"origin":"http://127.0.0.1:45682"}'; printf '%s\n' '{"v":5,"type":"request","id":9,"method":"e2e.fragment","params":"input"}'; IFS= read -r response; printf '%s' "$response" > "$0"; sleep 2"#,
                responseURL.path,
            ],
            sha256: String(repeating: "0", count: 64),
            sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
        )
        let supervisor = try BackendSupervisor(
            configuration: configuration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onRequest: { method, params in
                #expect(method == "e2e.fragment")
                #expect(params as? String == "input")
                return "output"
            },
            onState: { _ in }
        )
        supervisor.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while !FileManager.default.fileExists(atPath: responseURL.path), ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        let data = try Data(contentsOf: responseURL)
        let frame = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(frame["result"] as? String == "output")
        try await supervisor.stop()
    }

    @Test func staysReadyAfterCancellingReadinessTimeout() async throws {
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Ready",
            appIdentifier: "com.example.ready",
            executable: "/bin/sh",
            arguments: [
                "-c",
                #"IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45678,"origin":"http://127.0.0.1:45678"}'; IFS= read -r shutdown"#,
            ],
            sha256: String(repeating: "0", count: 64),
            sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
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

        try await supervisor.stop()
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
            sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
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
        try await supervisor.stop()
    }

    @Test func manualRetryReapsOldGroupBeforeNewBackendIsReady() async throws {
        let record = FileManager.default.temporaryDirectory.appendingPathComponent("fia-retry-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: record) }
        let configuration = FIABunConfiguration(
            development: true, appName: "Retry", appIdentifier: "com.example.retry",
            executable: "/bin/sh",
            arguments: ["-c", #"printf '%s\n' "$$" >> "$0"; IFS= read -r initialize; printf '%s\n' '{"v":5,"type":"ready","port":45678,"origin":"http://127.0.0.1:45678"}'; IFS= read -r shutdown"#, record.path],
            sha256: String(repeating: "0", count: 64), sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
        )
        var ready = 0
        let supervisor = try BackendSupervisor(configuration: configuration, applicationSupportDirectory: FileManager.default.temporaryDirectory, onRequest: { _, _ in nil }, onState: { if case .ready = $0 { ready += 1 } })
        supervisor.start()
        let initialDeadline = ContinuousClock.now + .seconds(2)
        while ready == 0, ContinuousClock.now < initialDeadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(ready == 1)
        supervisor.retry()
        let retryDeadline = ContinuousClock.now + .seconds(3)
        while ready < 2, ContinuousClock.now < retryDeadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(ready == 2)
        let pids = try String(contentsOf: record, encoding: .utf8).split(separator: "\n").compactMap { Int32($0) }
        #expect(pids.count == 2)
        if let first = pids.first { #expect(kill(-first, 0) == -1 && errno == ESRCH) }
        try await supervisor.stop()
    }

    private func expectProtocolRestart(script: String, identifier: String) async throws {
        let configuration = FIABunConfiguration(
            development: true,
            appName: "Protocol",
            appIdentifier: identifier,
            executable: "/bin/sh",
            arguments: ["-c", script],
            sha256: String(repeating: "0", count: 64),
            sessionSecret: String(repeating: "n", count: 64), webRoot: "/tmp/web", resourceDirectory: "/tmp/resources", version: "1.0.0", build: 1
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
        try await supervisor.stop()
    }
}
