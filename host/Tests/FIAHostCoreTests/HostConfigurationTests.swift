import FIAHostCore
import Foundation
import Testing

@Suite("Host configuration schema 8")
struct HostConfigurationTests {
    private let hash = String(repeating: "a", count: 64)

    private func data(
        development: Bool = false,
        executable: String = "Helpers/FIABackend",
        mutate: ((inout [String: Any]) -> Void)? = nil
    ) throws -> Data {
        var value: [String: Any] = [
            "schemaVersion": 8,
            "stdioProtocolVersion": 2,
            "development": development,
            "app": ["name": "Desktop", "identifier": "com.example.desktop"],
            "statusItem": ["symbol": "bolt.fill", "tooltip": "Desktop"],
            "backend": ["executable": executable, "arguments": [], "sha256": hash],
            "hostCapabilities": [
                "application", "statusItem", "webviews", "system",
                "notifications", "dialogs", "clipboard", "keychain",
                "globalShortcuts", "screens", "screenCapture",
            ],
        ]
        mutate?(&value)
        return try JSONSerialization.data(withJSONObject: value)
    }

    @Test func decodesProductionAndDevelopmentBackends() throws {
        let production = try HostConfiguration.decode(data())
        #expect(production.schemaVersion == 8)
        #expect(production.backend.executable == "Helpers/FIABackend")
        let development = try HostConfiguration.decode(data(development: true, executable: "/usr/bin/false"))
        #expect(development.development)
    }

    @Test func rejectsLegacyAndUnknownFields() throws {
        let legacy = try data { $0["mcpServers"] = [] }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(legacy) }
        let oldSchema = try data { $0["schemaVersion"] = 7 }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(oldSchema) }
    }

    @Test func validatesBackendLayoutProtocolAndCapabilities() throws {
        let escaped = try data(executable: "Helpers/other")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(escaped) }
        let protocolMismatch = try data { $0["stdioProtocolVersion"] = 1 }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(protocolMismatch) }
        let capabilities = try data { $0["hostCapabilities"] = ["application"] }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(capabilities) }
    }
}
