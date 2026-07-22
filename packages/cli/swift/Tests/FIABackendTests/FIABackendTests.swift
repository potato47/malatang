import Darwin
import Foundation
import Testing
@testable import FIABackend

@Suite("FIA Swift backend SDK")
struct FIABackendTests {
    private struct Payload: Codable, Equatable, Sendable {
        let message: String
        let count: Int
    }

    @Test func roundTripsCodableJSONValues() throws {
        let payload = Payload(message: "hello", count: 3)
        let value = try JSONValue.encode(payload)
        #expect(try value.decode(Payload.self) == payload)
    }

    @Test func registersTypedRoutesBeforeRunning() {
        let application = BackendApplication()
        application.handle("greet", input: Payload.self, output: Payload.self) { input, _ in input }
    }

    @Test func exchangesRequestsErrorsEventsAndOutOfOrderResponses() async throws {
        let application = BackendApplication()
        application.handle("greet", input: Payload.self, output: Payload.self) { input, context in
            try await context.emit(name: "greet.completed", payload: ["message": input.message])
            return input
        }
        application.handle("fail", input: Payload.self, output: Payload.self) { _, _ in
            throw BackendApplicationError(
                code: "EXPECTED_FAILURE",
                message: "Expected failure",
                details: .object(["retryable": .bool(false)])
            )
        }
        application.handle("slow", input: Payload.self, output: Payload.self) { input, _ in
            try await Task.sleep(for: .milliseconds(150))
            return input
        }
        application.handle("fast", input: Payload.self, output: Payload.self) { input, _ in input }

        let input = Pipe()
        let output = Pipe()
        let run = Task.detached {
            try await application.run(
                input: input.fileHandleForReading,
                output: output.fileHandleForWriting
            )
        }
        try write([
            "protocol": 1,
            "type": "initialize",
            "parentPid": Int(getpid()),
            "dataDirectory": "/tmp/fia-sdk-tests",
        ], to: input.fileHandleForWriting)
        try write(
            request(id: "greet-1", method: "greet", input: ["message": "hello", "count": 3]),
            to: input.fileHandleForWriting
        )
        try write(
            request(id: "invalid-1", method: "greet", input: ["wrong": true]),
            to: input.fileHandleForWriting
        )
        try write(
            request(id: "failure-1", method: "fail", input: ["message": "x", "count": 1]),
            to: input.fileHandleForWriting
        )
        try write(
            request(id: "slow-1", method: "slow", input: ["message": "slow", "count": 1]),
            to: input.fileHandleForWriting
        )
        try write(
            request(id: "fast-1", method: "fast", input: ["message": "fast", "count": 2]),
            to: input.fileHandleForWriting
        )
        try await Task.sleep(for: .milliseconds(350))
        try write(
            ["protocol": 1, "type": "shutdown", "reason": "applicationQuit"],
            to: input.fileHandleForWriting
        )
        try input.fileHandleForWriting.close()
        try await run.value
        try output.fileHandleForWriting.close()

        let messages = try readAll(from: output.fileHandleForReading)
        let ready = try #require(messages.first)
        #expect(ready["type"] as? String == "ready")
        #expect(ready["pid"] as? Int == Int(getpid()))
        let eventIndex = try #require(messages.firstIndex { $0["name"] as? String == "greet.completed" })
        let greetIndex = try #require(messages.firstIndex { $0["id"] as? String == "greet-1" })
        #expect(eventIndex < greetIndex)
        #expect(messages[greetIndex]["ok"] as? Bool == true)
        #expect(errorCode(try #require(messages.first { $0["id"] as? String == "invalid-1" })) == "INVALID_INPUT")
        let failure = try #require(messages.first { $0["id"] as? String == "failure-1" })
        #expect(errorCode(failure) == "EXPECTED_FAILURE")
        let failureDetails = (failure["error"] as? [String: Any])?["details"] as? [String: Any]
        #expect(failureDetails?["retryable"] as? Bool == false)
        let fastIndex = try #require(messages.firstIndex { $0["id"] as? String == "fast-1" })
        let slowIndex = try #require(messages.firstIndex { $0["id"] as? String == "slow-1" })
        #expect(fastIndex < slowIndex)
    }

    @Test func exitsCleanlyWhenHostInputCloses() async throws {
        let application = BackendApplication()
        let input = Pipe()
        let output = Pipe()
        let run = Task.detached {
            try await application.run(
                input: input.fileHandleForReading,
                output: output.fileHandleForWriting
            )
        }
        try write([
            "protocol": 1,
            "type": "initialize",
            "parentPid": Int(getpid()),
            "dataDirectory": "/tmp/fia-sdk-tests",
        ], to: input.fileHandleForWriting)
        try input.fileHandleForWriting.close()
        try await run.value
        try output.fileHandleForWriting.close()
        let messages = try readAll(from: output.fileHandleForReading)
        #expect(messages.count == 1)
        #expect(messages.first?["type"] as? String == "ready")
    }

    @Test func enforcesMessageAndConcurrencyLimits() async throws {
        let oversized = String(repeating: "x", count: FIABackendMaximumMessageBytes + 1)
        #expect(throws: BackendProtocolError.messageTooLarge) {
            _ = try BackendProtocol.inbound(oversized)
        }

        let registry = RequestRegistry()
        for index in 0..<FIABackendMaximumConcurrentRequests {
            #expect(await registry.reserve("request-\(index)", maximum: FIABackendMaximumConcurrentRequests))
        }
        #expect(await !registry.reserve("overflow", maximum: FIABackendMaximumConcurrentRequests))
        #expect(await !registry.reserve("request-0", maximum: FIABackendMaximumConcurrentRequests))
        await registry.cancelAll()
    }

    private func request(id: String, method: String, input: [String: Any]) -> [String: Any] {
        ["protocol": 1, "type": "request", "id": id, "method": method, "input": input]
    }

    private func errorCode(_ response: [String: Any]) -> String? {
        (response["error"] as? [String: Any])?["code"] as? String
    }

    private func write(_ object: [String: Any], to handle: FileHandle) throws {
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        data.append(0x0A)
        try handle.write(contentsOf: data)
    }

    private func readAll(from handle: FileHandle) throws -> [[String: Any]] {
        let data = try handle.readToEnd() ?? Data()
        return try String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .map { line in
                try #require(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
            }
    }
}
