import Foundation
import Testing
@testable import FIAHostCore

@Suite("Swift backend protocol")
struct BackendProtocolTests {
    @Test func parsesStrictWebKitBridgeRequests() throws {
        let request = try BackendBridgeProtocol.parse([
            "version": 1,
            "method": "notes.list",
            "input": ["limit": 20],
        ])
        #expect(request.method == "notes.list")
        let input = try JSONSerialization.jsonObject(with: request.input) as? [String: Int]
        #expect(input == ["limit": 20])

        #expect(throws: BackendProtocolError.self) {
            try BackendBridgeProtocol.parse(["version": 1, "method": "../unsafe", "input": NSNull()])
        }
        #expect(throws: BackendProtocolError.self) {
            try BackendBridgeProtocol.parse(["version": 1, "method": "notes.list", "input": NSNull(), "extra": true])
        }
    }

    @Test func encodesHostMessagesAndDecodesBackendMessagesStrictly() throws {
        let initialize = try BackendProcessProtocol.encodeInitialize(parentPid: 42, dataDirectory: "/tmp/app")
        let initializeObject = try JSONSerialization.jsonObject(with: initialize) as? [String: Any]
        #expect(initializeObject?["type"] as? String == "initialize")

        let request = try BackendProcessProtocol.encodeRequest(
            id: "request-1",
            method: "greet",
            input: Data(#"{"name":"FIA"}"#.utf8)
        )
        let requestObject = try JSONSerialization.jsonObject(with: request) as? [String: Any]
        #expect(requestObject?["method"] as? String == "greet")

        let cancel = try BackendProcessProtocol.encodeCancel(id: "request-1")
        let cancelObject = try JSONSerialization.jsonObject(with: cancel) as? [String: Any]
        #expect(cancelObject?["type"] as? String == "cancel")

        let ready = Data(#"{"protocol":1,"type":"ready","pid":99}"#.utf8)
        #expect(try BackendProcessProtocol.decodeLine(ready, expectedPID: 99) == .ready(pid: 99))

        let response = Data(#"{"protocol":1,"type":"response","id":"request-1","ok":true,"value":{"message":"hello"}}"#.utf8)
        guard case let .success(id, value) = try BackendProcessProtocol.decodeLine(response, expectedPID: 99) else {
            Issue.record("Expected success response")
            return
        }
        #expect(id == "request-1")
        #expect((try JSONSerialization.jsonObject(with: value) as? [String: String]) == ["message": "hello"])
    }

    @Test func decodesApplicationErrorsAndEvents() throws {
        let failure = Data(#"{"protocol":1,"type":"response","id":"request-2","ok":false,"error":{"code":"NOT_FOUND","message":"Missing","details":{"id":7}}}"#.utf8)
        guard case let .failure(id, code, message, details) = try BackendProcessProtocol.decodeLine(
            failure,
            expectedPID: 99
        ) else {
            Issue.record("Expected failure response")
            return
        }
        #expect(id == "request-2")
        #expect(code == "NOT_FOUND")
        #expect(message == "Missing")
        #expect(details != nil)

        let event = Data(#"{"protocol":1,"type":"event","name":"sync.progress","payload":{"progress":50}}"#.utf8)
        guard case let .event(name, _) = try BackendProcessProtocol.decodeLine(event, expectedPID: 99) else {
            Issue.record("Expected event")
            return
        }
        #expect(name == "sync.progress")
    }
}
