import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("MCP stdio supervisor")
struct MCPServerSupervisorTests {
    private func configuration(
        identifier: String,
        servers: [HostConfiguration.MCPServer]
    ) -> HostConfiguration {
        HostConfiguration(
            app: .init(name: "Supervisor", identifier: identifier, mode: .dock),
            window: .init(
                width: 800,
                height: 600,
                minWidth: 400,
                minHeight: 300,
                closeBehavior: .quit,
                restoreState: false,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            ),
            statusBar: .init(symbol: "bolt.fill", tooltip: "Supervisor"),
            ui: .init(mode: .bundled, entry: "UI/index.html"),
            mcpServers: servers
        )
    }

    private func waitUntil(
        timeout: Duration = .seconds(2),
        _ condition: @escaping @MainActor () -> Bool
    ) async throws {
        let deadline = ContinuousClock.now + timeout
        while !condition() && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(condition())
    }

    @Test func lazilyRoutesIndependentServersAndRestartsOnDemand() async throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-supervisor-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let hash = String(repeating: "0", count: 64)
        let configuration = configuration(
            identifier: "com.example.supervisor.\(UUID().uuidString)",
            servers: [
                .init(id: "app", executable: "/bin/cat", sha256: hash),
                .init(id: "search", executable: "/bin/cat", sha256: hash),
            ]
        )
        var received: [(String, Int)] = []
        var states: [(String, MCPServerSupervisor.State)] = []
        let supervisor = MCPServerSupervisor(
            configuration: configuration,
            applicationSupportDirectory: temporary,
            onMessage: { id, message in
                if let requestID = message["id"] as? Int { received.append((id, requestID)) }
            },
            onState: { id, state, _ in states.append((id, state)) }
        )
        #expect(states.isEmpty)

        try supervisor.send(
            serverID: "app",
            data: Data(#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#.utf8)
        )
        try supervisor.send(
            serverID: "search",
            data: Data(#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#.utf8)
        )
        try await waitUntil { received.count == 2 }
        #expect(Set(received.map(\.0)) == Set(["app", "search"]))
        #expect(states.contains { $0 == ("app", .connected) })
        #expect(states.contains { $0 == ("search", .connected) })

        supervisor.restart(serverID: "app")
        try supervisor.send(
            serverID: "app",
            data: Data(#"{"jsonrpc":"2.0","id":3,"method":"ping"}"#.utf8)
        )
        try await waitUntil { received.contains { $0 == ("app", 3) } }
        #expect(states.contains { $0 == ("app", .restarting) })
        supervisor.stopAll()
    }

    @Test func rejectsUnknownAndOversizedMessagesWithoutStartingAProcess() throws {
        let emptyConfiguration = configuration(identifier: "com.example.empty", servers: [])
        let supervisor = MCPServerSupervisor(
            configuration: emptyConfiguration,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onMessage: { _, _ in },
            onState: { _, _, _ in }
        )
        #expect(throws: MCPServerSupervisorError.self) {
            try supervisor.send(serverID: "missing", data: Data("{}".utf8))
        }

        let configured = configuration(
            identifier: "com.example.limit",
            servers: [.init(
                id: "app",
                executable: "/bin/cat",
                sha256: String(repeating: "0", count: 64)
            )]
        )
        let limited = MCPServerSupervisor(
            configuration: configured,
            applicationSupportDirectory: FileManager.default.temporaryDirectory,
            onMessage: { _, _ in },
            onState: { _, _, _ in }
        )
        #expect(throws: MCPServerSupervisorError.self) {
            try limited.send(
                serverID: "app",
                data: Data(repeating: 0x20, count: FIAMaximumMCPMessageBytes + 1)
            )
        }
    }

    @Test func decodesFragmentedAndOutOfOrderSizedStdoutLines() throws {
        var decoder = MCPStdoutDecoder()
        #expect(try decoder.append(Data(#"{"jsonrpc":"2.0","id":1,"res"#.utf8)).isEmpty)
        let completed = try decoder.append(Data(
            "ult\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n".utf8
        ))
        #expect(completed.count == 2)
        #expect(completed[0]["id"] as? Int == 1)
        #expect(completed[1]["id"] as? Int == 2)

        var polluted = MCPStdoutDecoder()
        #expect(throws: MCPStdoutDecoderError.self) {
            try polluted.append(Data("application log on stdout\n".utf8))
        }
        var oversized = MCPStdoutDecoder()
        #expect(throws: MCPStdoutDecoderError.self) {
            try oversized.append(Data(repeating: 0x20, count: FIAMaximumMCPMessageBytes + 1))
        }
    }

    @Test func marksCrashesFailedAndStartsAgainOnlyOnNewDemand() async throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-crash-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let configured = configuration(
            identifier: "com.example.crash.\(UUID().uuidString)",
            servers: [.init(
                id: "app",
                executable: "/usr/bin/false",
                sha256: String(repeating: "0", count: 64)
            )]
        )
        var states: [MCPServerSupervisor.State] = []
        let supervisor = MCPServerSupervisor(
            configuration: configured,
            applicationSupportDirectory: temporary,
            onMessage: { _, _ in },
            onState: { _, state, _ in states.append(state) }
        )

        try? supervisor.send(
            serverID: "app",
            data: Data(#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#.utf8)
        )
        try await waitUntil { states.filter { $0 == .failed }.count == 1 }
        let startsAfterCrash = states.filter { $0 == .starting }.count
        try await Task.sleep(for: .milliseconds(30))
        #expect(states.filter { $0 == .starting }.count == startsAfterCrash)

        try? supervisor.send(
            serverID: "app",
            data: Data(#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#.utf8)
        )
        try await waitUntil { states.filter { $0 == .starting }.count == startsAfterCrash + 1 }
        try await waitUntil { states.filter { $0 == .failed }.count == 2 }
        supervisor.stopAll()
    }
}
