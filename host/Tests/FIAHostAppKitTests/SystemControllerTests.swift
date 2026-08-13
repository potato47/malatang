import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
private final class MockSystemWorkspaceClient: SystemWorkspaceClient {
    var opened: [URL] = []
    var revealed: [[URL]] = []
    var trashed: [URL] = []
    var opensSuccessfully = true

    func open(_ url: URL) -> Bool {
        opened.append(url)
        return opensSuccessfully
    }

    func reveal(_ urls: [URL]) { revealed.append(urls) }

    func trash(_ url: URL) async throws -> URL {
        trashed.append(url)
        return URL(fileURLWithPath: "/Users/test/.Trash/\(url.lastPathComponent)")
    }
}

@MainActor
@Suite("System capability controller")
struct SystemControllerTests {
    @Test func opensURLsAndExistingPaths() async throws {
        let client = MockSystemWorkspaceClient()
        let controller = SystemController(client: client)
        _ = try await controller.execute(method: "system.openURL", params: ["url": "https://example.com/a"])
        _ = try await controller.execute(method: "system.openPath", params: ["path": "/tmp"])
        #expect(client.opened.map(\.scheme) == ["https", "file"])
    }

    @Test func revealsAndTrashesExistingPaths() async throws {
        let client = MockSystemWorkspaceClient()
        let controller = SystemController(client: client)
        _ = try await controller.execute(method: "system.revealPath", params: ["path": "/tmp"])
        let trashed = try await controller.execute(method: "system.trashPath", params: ["path": "/tmp"]) as? String
        #expect(client.revealed.first?.first?.path == "/tmp")
        #expect(client.trashed.first?.path == "/tmp")
        #expect(trashed == "/Users/test/.Trash/tmp")
    }

    @Test func rejectsInvalidMissingAndRootTrashPaths() async {
        let controller = SystemController(client: MockSystemWorkspaceClient())
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "system.openPath", params: ["path": "relative"])
        }
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "system.openPath", params: ["path": "/definitely/missing/fia-path"])
        }
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "system.trashPath", params: ["path": "/"])
        }
    }
}
