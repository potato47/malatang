import Foundation
import Testing
@testable import FIAHostCore

@Suite("Host schema 5 configuration")
struct HostConfigurationTests {
    private func configuration(
        ui: [String: Any] = ["mode": "bundled", "entry": "UI/index.html", "url": NSNull()],
        servers: [[String: Any]] = []
    ) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 5,
            "bridgeVersion": 1,
            "mcpProtocolVersion": "2026-07-28",
            "app": ["name": "Desktop", "identifier": "com.example.desktop", "mode": "hybrid"],
            "window": [
                "width": 1024,
                "height": 700,
                "minWidth": 720,
                "minHeight": 480,
                "closeBehavior": "hide",
                "restoreState": true,
                "alwaysOnTop": false,
                "visibleOnAllSpaces": false,
                "visibleOverFullScreen": false,
            ],
            "statusBar": ["symbol": "bolt.fill", "tooltip": "Desktop"],
            "ui": ui,
            "mcpServers": servers,
            "nativeCapabilities": ["tools", "resources", "subscriptions"],
        ])
    }

    @Test func decodesOnlyModernBundledConfiguration() throws {
        let decoded = try HostConfiguration.decode(configuration())
        #expect(decoded.schemaVersion == 5)
        #expect(decoded.bridgeVersion == 1)
        #expect(decoded.mcpProtocolVersion == "2026-07-28")
        #expect(decoded.ui.mode == .bundled)
        #expect(decoded.ui.entry == "UI/index.html")
        #expect(decoded.nativeCapabilities == ["tools", "resources", "subscriptions"])
    }

    @Test func acceptsExactLocalhostDevelopmentOrigin() throws {
        let data = try configuration(ui: [
            "mode": "development",
            "entry": NSNull(),
            "url": "http://127.0.0.1:49152/",
        ])
        #expect(try HostConfiguration.decode(data).ui.isDevelopment)

        let localhost = try configuration(ui: [
            "mode": "development",
            "entry": NSNull(),
            "url": "http://localhost:49152/",
        ])
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(localhost) }
    }

    @Test func validatesMCPServersAndChecksums() throws {
        let hash = String(repeating: "a", count: 64)
        let decoded = try HostConfiguration.decode(configuration(servers: [[
            "id": "app",
            "executable": "Helpers/MCPServers/app",
            "arguments": [],
            "sha256": hash,
        ], [
            "id": "search",
            "executable": "Helpers/MCPServers/search",
            "arguments": ["--stdio"],
            "sha256": hash,
        ]]))
        #expect(decoded.mcpServers.map(\.id) == ["app", "search"])

        let reserved = try configuration(servers: [[
            "id": "fia.other",
            "executable": "Helpers/MCPServers/other",
            "arguments": [],
            "sha256": hash,
        ]])
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(reserved) }

        let escaped = try configuration(servers: [[
            "id": "search",
            "executable": "../search",
            "arguments": [],
            "sha256": hash,
        ]])
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(escaped) }
    }

    @Test func rejectsLegacySchemasAndUnknownFields() throws {
        let legacy = #"{"schemaVersion":4}"#.data(using: .utf8)!
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(legacy) }
        var root = try #require(JSONSerialization.jsonObject(with: configuration()) as? [String: Any])
        root["runtime"] = ["mode": "production"]
        let unknown = try JSONSerialization.data(withJSONObject: root)
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(unknown) }
    }

    @Test func rejectsTraversalAndWrongProtocolMetadata() throws {
        let traversal = try configuration(ui: [
            "mode": "bundled",
            "entry": "UI/../fia-config.json",
            "url": NSNull(),
        ])
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(traversal) }

        var root = try #require(JSONSerialization.jsonObject(with: configuration()) as? [String: Any])
        root["mcpProtocolVersion"] = "2025-11-25"
        #expect(throws: HostConfigurationError.self) {
            try HostConfiguration.decode(JSONSerialization.data(withJSONObject: root))
        }
    }
}
