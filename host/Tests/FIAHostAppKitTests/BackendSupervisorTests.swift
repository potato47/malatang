import Darwin
import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("Swift backend supervisor")
struct BackendSupervisorTests {
    @Test func invokesTimesOutRestartsAndReportsCrashes() async throws {
        let fixture = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-backend-fixture-\(UUID().uuidString)")
        let identifier = "com.example.fia-backend-tests-\(UUID().uuidString.lowercased())"
        let dataDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent(identifier, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: fixture)
            try? FileManager.default.removeItem(at: dataDirectory)
        }
        try Data(Self.fixtureScript.utf8).write(to: fixture, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.path)

        var readyCount = 0
        var failureCount = 0
        var failures: [String] = []
        let supervisor = BackendSupervisor(
            configuration: configuration(identifier: identifier, executable: fixture.path),
            requestTimeout: .milliseconds(100),
            startupTimeout: .seconds(2)
        ) { event in
            switch event {
            case .ready: readyCount += 1
            case let .failed(title, detail):
                failureCount += 1
                failures.append("\(title): \(detail)")
            case .applicationEvent: break
            }
        }

        supervisor.start()
        #expect(await waitUntil { supervisor.isReady && readyCount == 1 })
        let originalPID = try #require(supervisor.processIdentifier)
        let value = try await supervisor.invoke(.init(method: "echo", input: Data("{}".utf8)))
        let response = try #require(JSONSerialization.jsonObject(with: value) as? [String: Any])
        #expect(response["message"] as? String == "ok")

        do {
            _ = try await supervisor.invoke(.init(method: "hold", input: Data("{}".utf8)))
            Issue.record("Expected the held request to time out")
        } catch let error as BackendInvocationError {
            #expect(error.code == .backendTimeout)
        }

        let held = Task { @MainActor in
            try await supervisor.invoke(.init(method: "hold", input: Data("{}".utf8)))
        }
        try await Task.sleep(for: .milliseconds(20))
        supervisor.restart()
        do {
            _ = try await held.value
            Issue.record("Expected the held request to fail during restart")
        } catch let error as BackendInvocationError {
            #expect(error.code == .backendRestarted)
        }
        #expect(
            await waitUntil { supervisor.isReady && readyCount == 2 },
            "ready=\(readyCount), running=\(supervisor.isRunning), failures=\(failures)"
        )
        #expect(supervisor.processIdentifier != originalPID)

        let restartedPID = try #require(supervisor.processIdentifier)
        #expect(Darwin.kill(restartedPID, SIGKILL) == 0)
        #expect(await waitUntil { !supervisor.isRunning && failureCount == 1 })
        do {
            _ = try await supervisor.invoke(.init(method: "echo", input: Data("{}".utf8)))
            Issue.record("Expected a crashed backend to be unavailable")
        } catch let error as BackendInvocationError {
            #expect(error.code == .backendUnavailable)
        }
        await stop(supervisor)
    }

    private func configuration(identifier: String, executable: String) -> HostConfiguration {
        HostConfiguration(
            schemaVersion: 4,
            protocolVersion: 1,
            app: .init(name: "Backend Test", identifier: identifier, mode: .dock),
            window: .init(
                width: 800,
                height: 600,
                minWidth: 500,
                minHeight: 400,
                closeBehavior: .quit,
                restoreState: false,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            ),
            statusBar: .init(symbol: "bolt.fill", tooltip: "Backend Test"),
            runtime: .init(
                mode: .development,
                executable: "/usr/bin/true",
                arguments: ["development"]
            ),
            backend: .init(mode: .development, executable: executable)
        )
    }

    private func waitUntil(
        timeout: Duration = .seconds(5),
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !condition() {
            if clock.now >= deadline { return false }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return true
    }

    private func stop(_ supervisor: BackendSupervisor) async {
        await withCheckedContinuation { continuation in
            supervisor.stop { continuation.resume() }
        }
    }

    private static let fixtureScript = #"""
    #!/bin/sh
    IFS= read -r initialize || exit 0
    printf '{"protocol":1,"type":"ready","pid":%d}\n' "$$"
    while IFS= read -r line; do
      case "$line" in
        *'"type":"shutdown"'*) exit 0 ;;
        *'"method":"hold"'*) continue ;;
        *'"type":"request"'*)
          id=$(printf '%s' "$line" | /usr/bin/sed -E 's/.*"id":"([^"]+)".*/\1/')
          printf '{"protocol":1,"type":"response","id":"%s","ok":true,"value":{"message":"ok"}}\n' "$id"
          ;;
      esac
    done
    """#
}
