import Darwin
import Foundation
import Testing

@testable import FIAMacOS

@MainActor
@Suite("Managed process")
struct ManagedProcessTests {
    private let quick = ManagedProcess.StopPolicy(
        graceful: .milliseconds(40), terminate: .milliseconds(40), kill: .seconds(2))

    @Test func normalExitAndConcurrentStopAreAwaited() async throws {
        let process = ManagedProcess(
            executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "read line; exit 7"])
        try process.start()
        let first = Task { try await process.stop { try? process.write(Data("quit\n".utf8)) } }
        let second = Task { try await process.stop() }
        try await first.value
        try await second.value
        #expect(process.terminationStatus == 7)
        #expect(kill(-process.processIdentifier, 0) == -1 && errno == ESRCH)
        try await process.stop()
    }

    @Test func killsUncooperativeProcessAndDescendants() async throws {
        let process = ManagedProcess(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "trap '' TERM; /bin/sleep 60 & echo ready; wait"])
        try process.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while process.stdout.isEmpty, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
        #expect(!process.stdout.isEmpty)
        try await process.stop(policy: quick)
        #expect(process.terminationStatus != nil)
        #expect(kill(-process.processIdentifier, 0) == -1 && errno == ESRCH)
    }

    @Test func cleansDescendantsAfterLeaderExit() async throws {
        let process = ManagedProcess(
            executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "/bin/sleep 60 & exit 0"])
        try process.start()
        let deadline = ContinuousClock.now + .seconds(2)
        while process.terminationStatus == nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        try await process.stop(policy: quick)
        #expect(kill(-process.processIdentifier, 0) == -1 && errno == ESRCH)
    }

    @Test func ownershipFailureDoesNotSignalAndCanRetry() async throws {
        let process = ManagedProcess(executable: URL(fileURLWithPath: "/bin/sleep"), arguments: ["60"])
        try process.start()
        let actualState = process.groupState
        let actualSignal = process.signalGroup
        var signals = 0
        process.groupState = { _, _ in -1 }
        process.signalGroup = { _, _, _ in
            signals += 1
            return EPERM
        }
        await #expect(throws: ManagedProcessError.self) { try await process.stop(policy: quick) }
        #expect(signals == 0)
        #expect(process.isRunning)
        process.groupState = actualState
        process.signalGroup = actualSignal
        try await process.stop(policy: quick)
    }

    @Test func signalFailureIsReportedAndCanRetry() async throws {
        let process = ManagedProcess(executable: URL(fileURLWithPath: "/bin/sleep"), arguments: ["60"])
        try process.start()
        let actualSignal = process.signalGroup
        process.signalGroup = { _, _, _ in EPERM }
        await #expect(throws: ManagedProcessError.self) { try await process.stop(policy: quick) }
        process.signalGroup = actualSignal
        try await process.stop(policy: quick)
    }

    @Test func outputIsLosslessButLogsAreBounded() async throws {
        let process = ManagedProcess(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                "i=0; while [ $i -lt 2048 ]; do printf 'abcdefgh'; printf 'ijklmnop' >&2; i=$((i+1)); done; read line",
            ], logLimit: 64)
        var output = Data()
        var error = Data()
        process.onOutput = { chunk in
            switch chunk.channel {
            case .stdout: output.append(chunk.data)
            case .stderr: error.append(chunk.data)
            }
        }
        try process.start()
        let deadline = ContinuousClock.now + .seconds(5)
        while output.count < 16_384 || error.count < 16_384, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        try await process.stop(policy: quick)
        #expect(output == Data(String(repeating: "abcdefgh", count: 2048).utf8))
        #expect(error == Data(String(repeating: "ijklmnop", count: 2048).utf8))
        #expect(process.stdout.count == 64 && process.stderr.count == 64)
    }

    @Test func spawnFailureAndSingleLaunchContract() async throws {
        let missing = ManagedProcess(executable: URL(fileURLWithPath: "/no/such/fia-command"))
        #expect(throws: ManagedProcessError.self) { try missing.start() }
        let process = ManagedProcess(executable: URL(fileURLWithPath: "/usr/bin/true"))
        try process.start()
        #expect(throws: ManagedProcessError.self) { try process.start() }
        try await process.stop(policy: quick)
    }
    @Test func outputStreamFinishesAfterEOF() async throws {
        let process = ManagedProcess(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "printf final"])
        let stream = process.output()
        let receiver = Task { @MainActor in
            var received = Data()
            for await chunk in stream { received.append(chunk.data) }
            return received
        }
        try process.start()
        try await process.stop(policy: quick)
        let timeout = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            receiver.cancel()
        }
        let output = await receiver.value
        timeout.cancel()
        #expect(output == Data("final".utf8))
        #expect(!receiver.isCancelled)
    }

    @Test func stdinBackpressurePreservesWholeWritesAndRejectsOversizedChunks() async throws {
        let process = ManagedProcess(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: ["-c", "IFS= read -r line; printf '%s' \"${#line}\"; read quit"])
        try process.start()
        #expect(throws: ManagedProcessError.self) { try process.write(Data(repeating: 120, count: 4_194_305)) }
        var payload = Data(repeating: 120, count: 262_144)
        payload.append(10)
        try process.write(payload)
        let deadline = ContinuousClock.now + .seconds(5)
        while process.stdout.isEmpty, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(20)) }
        #expect(String(data: process.stdout, encoding: .utf8) == "262144")
        try await process.stop { try? process.write(Data("quit\n".utf8)) }
        #expect(process.terminationStatus == 0)
    }

}
