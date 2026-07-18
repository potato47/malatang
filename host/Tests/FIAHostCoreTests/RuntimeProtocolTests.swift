import Foundation
import Testing
@testable import FIAHostCore

@Suite("Runtime protocol")
struct RuntimeProtocolTests {
    @Test func generatesIndependentBase64URLTokens() throws {
        let first = try RuntimeProtocol.secureToken()
        let second = try RuntimeProtocol.secureToken()
        #expect(first.count == 43)
        #expect(first != second)
        #expect(first.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil)
    }

    @Test func encodesInitializeAsOneLine() throws {
        let message = InitializeMessage(
            bootstrapToken: String(repeating: "a", count: 43),
            controlToken: String(repeating: "b", count: 43),
            parentPid: 42,
            dataDirectory: "/tmp/fia"
        )
        let line = try RuntimeProtocol.encodeLine(message)
        #expect(line.last == 0x0A)
        #expect(String(decoding: line, as: UTF8.self).contains(#""type":"initialize""#))
    }

    @Test func decodesOnlyStrictReadyMessages() throws {
        let data = Data(#"{"protocol":1,"type":"ready","port":49152,"pid":42}"#.utf8)
        #expect(try RuntimeProtocol.decodeReadyLine(data, expectedPID: 42).port == 49152)

        let extra = Data(#"{"protocol":1,"type":"ready","port":49152,"pid":42,"extra":true}"#.utf8)
        #expect(throws: RuntimeProtocolError.self) {
            try RuntimeProtocol.decodeReadyLine(extra, expectedPID: 42)
        }
        #expect(throws: RuntimeProtocolError.self) {
            try RuntimeProtocol.decodeReadyLine(data, expectedPID: 99)
        }
    }
}

