import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("Native MCP server")
struct NativeMCPServerTests {
    private func state() throws -> DesktopState {
        try DesktopState(
            dockVisible: true,
            statusBarVisible: true,
            statusBarSymbol: "bolt.fill",
            window: .init(
                visible: true,
                focused: false,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            )
        )
    }

    private func request(
        id: Any = 1,
        method: String,
        params: [String: Any] = [:]
    ) -> [String: Any] {
        var modernParams = params
        modernParams["_meta"] = [
            "io.modelcontextprotocol/protocolVersion": FIAMCPProtocolVersion,
            "io.modelcontextprotocol/clientCapabilities": [:],
        ]
        return ["jsonrpc": "2.0", "id": id, "method": method, "params": modernParams]
    }

    @Test func discoversModernToolsAndResources() throws {
        let current = try state()
        let server = NativeMCPServer { _ in current }

        let discover = try #require(server.handle(request(method: "server/discover")))
        let discoverResult = try #require(discover["result"] as? [String: Any])
        #expect(discoverResult["supportedVersions"] as? [String] == [FIAMCPProtocolVersion])
        #expect(discoverResult["resultType"] as? String == "complete")

        let tools = try #require(server.handle(request(method: "tools/list")))
        let toolResult = try #require(tools["result"] as? [String: Any])
        #expect((toolResult["tools"] as? [[String: Any]])?.contains {
            $0["name"] as? String == "window.setAlwaysOnTop"
        } == true)

        let resources = try #require(server.handle(request(method: "resources/list")))
        let resourceResult = try #require(resources["result"] as? [String: Any])
        #expect((resourceResult["resources"] as? [[String: Any]])?.first?["uri"] as? String
            == NativeMCPServer.stateResourceURI)
    }

    @Test func callsToolsAndReturnsStructuredState() throws {
        var command: NativeMCPCommand?
        let current = try state()
        let server = NativeMCPServer {
            command = $0
            return current
        }
        let response = try #require(server.handle(request(
            method: "tools/call",
            params: [
                "name": "window.setAlwaysOnTop",
                "arguments": ["enabled": true],
            ]
        )))
        let result = try #require(response["result"] as? [String: Any])

        #expect(command == .setAlwaysOnTop(true))
        #expect(result["isError"] as? Bool == false)
        #expect(result["resultType"] as? String == "complete")
        #expect(result["structuredContent"] is [String: Any])
    }

    @Test func rejectsLegacyEnvelopesAndPreservesNativeErrorCodes() throws {
        let current = try state()
        let server = NativeMCPServer { _ in current }
        let legacy = server.handle([
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": [:],
        ])
        #expect((legacy?["error"] as? [String: Any])?["code"] as? Int == -32602)

        let invalid = try #require(server.handle(request(
            method: "tools/call",
            params: [
                "name": "window.setAlwaysOnTop",
                "arguments": ["enabled": "yes"],
            ]
        )))
        let error = try #require(invalid["error"] as? [String: Any])
        let data = try #require(error["data"] as? [String: Any])
        #expect(error["code"] as? Int == -32602)
        #expect(data["code"] as? String == NativeMCPErrorCode.invalidArgument.rawValue)
    }

    @Test func acknowledgesModernResourceSubscriptionsAndScopesNotifications() throws {
        let current = try state()
        let server = NativeMCPServer { _ in current }
        let acknowledgment = try #require(server.handle(request(
            id: "listen:7",
            method: "subscriptions/listen",
            params: [
                "notifications": [
                    "resourceSubscriptions": [
                        NativeMCPServer.stateResourceURI,
                        "fia://native/unknown",
                    ],
                ],
            ]
        )))
        #expect(acknowledgment["method"] as? String == "notifications/subscriptions/acknowledged")
        let notifications = server.resourceUpdatedNotifications()
        #expect(notifications.count == 1)
        let params = try #require(notifications.first?["params"] as? [String: Any])
        #expect(params["uri"] as? String == NativeMCPServer.stateResourceURI)

        _ = server.handle(request(
            id: 8,
            method: "notifications/cancelled",
            params: ["requestId": "listen:7"]
        ))
        #expect(server.resourceUpdatedNotifications().isEmpty)
    }
}
