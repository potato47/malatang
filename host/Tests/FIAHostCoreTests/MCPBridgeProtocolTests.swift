import Foundation
import Testing
@testable import FIAHostCore

@Suite("MCP bridge protocol")
struct MCPBridgeProtocolTests {
    private func request(serverID: String = "app", message: [String: Any]? = nil) -> [String: Any] {
        [
            "bridgeVersion": 1,
            "serverId": serverID,
            "message": message ?? [
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": [
                    "_meta": [
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": [:],
                    ],
                ],
            ],
        ]
    }

    @Test func preservesTheInnerJSONRPCMessage() throws {
        let body = request()
        let envelope = try MCPBridgeProtocol.parse(body)
        #expect(envelope.serverID == "app")
        let decoded = try #require(JSONSerialization.jsonObject(with: envelope.data) as? [String: Any])
        #expect(decoded["method"] as? String == "tools/list")
        #expect(decoded["jsonrpc"] as? String == "2.0")
    }

    @Test func acceptsNativeAndExternalIDsButRejectsReservedNamespaces() throws {
        #expect(try MCPBridgeProtocol.parse(request(serverID: "fia.native")).serverID == "fia.native")
        #expect(try MCPBridgeProtocol.parse(request(serverID: "search.v2")).serverID == "search.v2")
        #expect(throws: MCPBridgeProtocolError.self) {
            try MCPBridgeProtocol.parse(request(serverID: "fia.search"))
        }
        #expect(throws: MCPBridgeProtocolError.self) {
            try MCPBridgeProtocol.parse(request(serverID: "../search"))
        }
    }

    @Test func enforcesMessageShapeAndOneMiBLimit() {
        #expect(throws: MCPBridgeProtocolError.self) {
            try MCPBridgeProtocol.parse(request(message: ["jsonrpc": "1.0", "method": "ping"]))
        }
        #expect(throws: MCPBridgeProtocolError.self) {
            try MCPBridgeProtocol.parse(request(message: [
                "jsonrpc": "2.0",
                "id": 1,
                "result": [:],
            ]))
        }
        #expect(throws: MCPBridgeProtocolError.self) {
            try MCPBridgeProtocol.parse(request(message: [
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": ["value": String(repeating: "x", count: FIAMaximumMCPMessageBytes)],
            ]))
        }
    }

    @Test func authorizesOnlyTheExactMainFrameOrigin() throws {
        let policy = try #require(MCPBridgeOriginPolicy(origin: URL(string: "http://127.0.0.1:49152")!))
        #expect(policy.allows(isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 49152))
        #expect(!policy.allows(isMainFrame: false, scheme: "http", host: "127.0.0.1", port: 49152))
        #expect(!policy.allows(isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 49153))
    }
}
