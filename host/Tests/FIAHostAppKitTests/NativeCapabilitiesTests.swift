import AppKit
import FIAHostCore
import Foundation
import Testing
import UniformTypeIdentifiers
import UserNotifications
@testable import FIAHostAppKit

@MainActor
private final class MockNotificationClient: NotificationClient {
    var onClick: ((String) -> Void)?
    var status: UNAuthorizationStatus = .authorized
    var sent: [String] = []
    var removed: [String] = []

    func authorizationStatus() async -> UNAuthorizationStatus { status }
    func requestAuthorization() async throws { status = .authorized }
    func send(id: String, title: String, subtitle: String?, body: String?, sound: Bool) async throws {
        sent.append(id)
    }
    func remove(id: String) { removed.append(id) }
    func removeAll() { removed.append("*") }
}

@MainActor
private final class MockFilePanelClient: FilePanelClient {
    var openFileConfiguration: OpenFilePanelConfiguration?
    var openDirectoryConfiguration: OpenDirectoryPanelConfiguration?
    var saveFileConfiguration: SaveFilePanelConfiguration?

    func openFiles(_ configuration: OpenFilePanelConfiguration) async throws -> [URL]? {
        openFileConfiguration = configuration
        return [URL(fileURLWithPath: "/tmp/input.json")]
    }

    func openDirectories(_ configuration: OpenDirectoryPanelConfiguration) async throws -> [URL]? {
        openDirectoryConfiguration = configuration
        return nil
    }

    func saveFile(_ configuration: SaveFilePanelConfiguration) async throws -> URL? {
        saveFileConfiguration = configuration
        return URL(fileURLWithPath: "/tmp/output.json")
    }
}

@MainActor
private final class MockClipboardClient: ClipboardClient {
    var text: String?
    var png: Data?
    func readText() -> String? { text }
    func writeText(_ text: String) -> Bool { self.text = text; return true }
    func writePNG(_ data: Data) -> Bool { png = data; return !data.isEmpty }
    func clear() { text = nil; png = nil }
}

private final class MockKeychainClient: KeychainClient {
    var values: [String: Data] = [:]

    func get(service: String, account: String) throws -> Data? { values["\(service):\(account)"] }
    func set(service: String, account: String, value: Data) throws { values["\(service):\(account)"] = value }
    func delete(service: String, account: String) throws -> Bool {
        values.removeValue(forKey: "\(service):\(account)") != nil
    }
}

@MainActor
@Suite("Native capability controllers")
struct NativeCapabilitiesTests {
    @Test func sendsNotificationsAndQueuesClicksUntilBackendIsReady() async throws {
        let client = MockNotificationClient()
        let controller = NotificationController(client: client)
        var clicks: [String] = []
        controller.onEvent = { payload in
            if let id = payload["id"] as? String { clicks.append(id) }
        }

        client.onClick?("queued")
        #expect(clicks.isEmpty)
        controller.setBackendReady(true)
        #expect(clicks == ["queued"])

        let result = try await controller.execute(
            method: "notifications.send",
            params: ["id": "build-complete", "title": "Complete", "sound": true]
        ) as? [String: String]
        #expect(result?["id"] == "build-complete")
        #expect(client.sent == ["build-complete"])
    }

    @Test func rejectsNotificationSendWithoutAuthorization() async {
        let client = MockNotificationClient()
        client.status = .denied
        let controller = NotificationController(client: client)
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "notifications.send", params: ["title": "Denied"])
        }
    }

    @Test func mapsDialogOptionsAndReturnsAbsolutePaths() async throws {
        let client = MockFilePanelClient()
        let controller = DialogController(client: client)
        let opened = try await controller.execute(
            method: "dialogs.openFile",
            params: [
                "directory": "/tmp", "multiple": true, "showHiddenFiles": true,
                "allowedExtensions": ["json"],
            ]
        ) as? [String]
        #expect(opened == ["/tmp/input.json"])
        #expect(client.openFileConfiguration?.multiple == true)
        #expect(client.openFileConfiguration?.showHiddenFiles == true)
        #expect(client.openFileConfiguration?.allowedContentTypes.count == 1)
        #expect(client.openFileConfiguration?.allowedContentTypes.first?.preferredFilenameExtension == "json")

        let saved = try await controller.execute(
            method: "dialogs.saveFile",
            params: ["directory": "/tmp", "name": "output.json", "canCreateDirectories": false]
        ) as? String
        #expect(saved == "/tmp/output.json")
        #expect(client.saveFileConfiguration?.name == "output.json")
        #expect(client.saveFileConfiguration?.canCreateDirectories == false)
    }

    @Test func readsWritesAndClearsTextClipboard() throws {
        let client = MockClipboardClient()
        let controller = ClipboardController(client: client)
        #expect(try controller.execute(method: "clipboard.readText", params: [:]) is NSNull)
        _ = try controller.execute(method: "clipboard.writeText", params: ["text": "hello"])
        #expect(try controller.execute(method: "clipboard.readText", params: [:]) as? String == "hello")
        _ = try controller.execute(method: "clipboard.clear", params: [:])
        #expect(client.text == nil)
    }

    @Test func writesPNGImagesFromFiles() throws {
        let client = MockClipboardClient()
        let controller = ClipboardController(client: client)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-clipboard-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("valid.png")
        let image = NSImage(size: NSSize(width: 1, height: 1))
        image.lockFocus()
        NSColor.red.setFill()
        NSRect(x: 0, y: 0, width: 1, height: 1).fill()
        image.unlockFocus()
        let bitmap = try #require(NSBitmapImageRep(data: image.tiffRepresentation!))
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: path)

        _ = try controller.execute(method: "clipboard.writeImage", params: ["path": path.path])
        #expect(client.png == png)

        let disguisedJPEG = directory.appendingPathComponent("disguised.png")
        let jpeg = try #require(bitmap.representation(using: .jpeg, properties: [:]))
        try jpeg.write(to: disguisedJPEG)
        #expect(throws: HostRequestExecutionError.self) {
            try controller.execute(method: "clipboard.writeImage", params: ["path": disguisedJPEG.path])
        }

        let arbitrary = directory.appendingPathComponent("arbitrary.png")
        try Data("not an image".utf8).write(to: arbitrary)
        #expect(throws: HostRequestExecutionError.self) {
            try controller.execute(method: "clipboard.writeImage", params: ["path": arbitrary.path])
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.execute(method: "clipboard.writeImage", params: ["path": "/tmp/not-a-png.jpg"])
        }

        let directoryNamedPNG = directory.appendingPathComponent("folder.png")
        try FileManager.default.createDirectory(at: directoryNamedPNG, withIntermediateDirectories: false)
        #expect(throws: HostRequestExecutionError.self) {
            try controller.execute(method: "clipboard.writeImage", params: ["path": directoryNamedPNG.path])
        }
    }

    @Test func isolatesKeychainValuesByBundleIdentifier() throws {
        let client = MockKeychainClient()
        let first = KeychainController(service: "com.example.first", client: client)
        let second = KeychainController(service: "com.example.second", client: client)
        _ = try first.execute(method: "keychain.set", params: ["key": "token", "value": "secret"])
        #expect(try first.execute(method: "keychain.get", params: ["key": "token"]) as? String == "secret")
        #expect(try second.execute(method: "keychain.get", params: ["key": "token"]) is NSNull)
        #expect(try first.execute(method: "keychain.delete", params: ["key": "token"]) as? Bool == true)
        #expect(try first.execute(method: "keychain.delete", params: ["key": "token"]) as? Bool == false)
    }
}
