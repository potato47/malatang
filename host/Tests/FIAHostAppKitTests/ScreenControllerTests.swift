import AppKit
import CoreGraphics
import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
private final class MockScreenProvider: ScreenProvider {
    var values: [HostScreenDescriptor]
    var pointer: CGPoint

    init(values: [HostScreenDescriptor], pointer: CGPoint = .zero) {
        self.values = values
        self.pointer = pointer
    }

    func screens() -> [HostScreenDescriptor] { values }
    func pointerLocation() -> CGPoint { pointer }
}

@MainActor
private struct MockScreenCaptureClient: ScreenCaptureClient {
    let status: ScreenCaptureAuthorization
    let requested: ScreenCaptureAuthorizationRequest
    let image: CGImage
    let onCapture: (ScreenCaptureRequest) -> Void

    func authorizationStatus() -> ScreenCaptureAuthorization { status }
    func requestAuthorization() -> ScreenCaptureAuthorizationRequest { requested }
    func capture(_ request: ScreenCaptureRequest) async throws -> CGImage {
        onCapture(request)
        return image
    }
}

@MainActor
private final class BlockingScreenCaptureClient: ScreenCaptureClient {
    let image: CGImage
    var onStart: (() -> Void)?
    private var continuation: CheckedContinuation<CGImage, Never>?

    init(image: CGImage) { self.image = image }

    func authorizationStatus() -> ScreenCaptureAuthorization { .authorized }
    func requestAuthorization() -> ScreenCaptureAuthorizationRequest { .authorized }
    func capture(_ request: ScreenCaptureRequest) async throws -> CGImage {
        onStart?()
        return await withCheckedContinuation { continuation = $0 }
    }

    func finish() {
        continuation?.resume(returning: image)
        continuation = nil
    }
}

@MainActor
@Suite("Screen capabilities")
struct ScreenControllerTests {
    private func screens() -> [HostScreenDescriptor] {
        [
            .init(
                id: 11,
                name: "Main",
                frame: CGRect(x: 0, y: 0, width: 1440, height: 900),
                visibleFrame: CGRect(x: 0, y: 25, width: 1440, height: 851),
                scaleFactor: 2,
                main: true
            ),
            .init(
                id: 22,
                name: "Left",
                frame: CGRect(x: -1280, y: 100, width: 1280, height: 720),
                visibleFrame: CGRect(x: -1280, y: 100, width: 1280, height: 695),
                scaleFactor: 1,
                main: false
            ),
        ]
    }

    @Test func listsScreensInStableTopLeftCoordinates() throws {
        let provider = MockScreenProvider(values: screens(), pointer: CGPoint(x: -100, y: 200))
        let controller = ScreensController(provider: provider)
        let result = try #require(try controller.execute(method: "screens.list", params: [:]) as? [[String: Any]])
        #expect(result.map { $0["id"] as? String } == ["11", "22"])
        #expect(result[0]["main"] as? Bool == true)
        #expect(result[1]["containsPointer"] as? Bool == true)
        let leftFrame = try #require(result[1]["frame"] as? [String: Double])
        #expect(leftFrame == ["x": -1280, "y": 80, "width": 1280, "height": 720])
    }

    @Test func reportsAndRequestsAuthorization() async throws {
        let image = try makeImage(width: 2, height: 2)
        let client = MockScreenCaptureClient(status: .notAuthorized, requested: .restartRequired, image: image) { _ in }
        let controller = ScreenCaptureController(
            backendDirectory: URL(fileURLWithPath: "/tmp"),
            screenProvider: MockScreenProvider(values: screens()),
            client: client
        )
        #expect(try await controller.execute(method: "screenCapture.getAuthorizationStatus", params: [:]) as? String == "notAuthorized")
        #expect(try await controller.execute(method: "screenCapture.requestAuthorization", params: [:]) as? String == "restartRequired")
    }

    @Test func nativeAuthorizationRequestCoversAllOutcomes() {
        var preflightResults = [true]
        var requestCalls = 0
        var client = NativeScreenCaptureClient(
            preflightAuthorization: { preflightResults.removeFirst() },
            requestAccess: {
                requestCalls += 1
                return true
            }
        )
        #expect(client.requestAuthorization() == .authorized)
        #expect(requestCalls == 0)

        preflightResults = [false]
        client = NativeScreenCaptureClient(
            preflightAuthorization: { preflightResults.removeFirst() },
            requestAccess: { false }
        )
        #expect(client.requestAuthorization() == .denied)

        preflightResults = [false, false]
        client = NativeScreenCaptureClient(
            preflightAuthorization: { preflightResults.removeFirst() },
            requestAccess: { true }
        )
        #expect(client.requestAuthorization() == .restartRequired)

        preflightResults = [false, true]
        client = NativeScreenCaptureClient(
            preflightAuthorization: { preflightResults.removeFirst() },
            requestAccess: { true }
        )
        #expect(client.requestAuthorization() == .authorized)
    }

    @Test func capturesRegionsToManagedPNGDestinations() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fia-capture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("shot.png")
        let image = try makeImage(width: 600, height: 400)
        let client = MockScreenCaptureClient(status: .authorized, requested: .authorized, image: image) { request in
            #expect(request.screenID == 11)
            #expect(request.sourceRect == CGRect(x: 10, y: 20, width: 300, height: 200))
            #expect(request.pixelWidth == 600)
            #expect(request.pixelHeight == 400)
            #expect(request.showsCursor)
        }
        let controller = ScreenCaptureController(
            backendDirectory: root,
            screenProvider: MockScreenProvider(values: screens()),
            client: client
        )
        let receipt = try #require(try await controller.execute(method: "screenCapture.capture", params: [
            "screenId": "11",
            "region": ["x": 10, "y": 20, "width": 300, "height": 200],
            "destination": destination.path,
            "showsCursor": true,
        ]) as? [String: Any])
        #expect(receipt["path"] as? String == destination.path)
        #expect(receipt["pixelWidth"] as? Int == 600)
        #expect(receipt["pixelHeight"] as? Int == 400)
        #expect(FileManager.default.fileExists(atPath: destination.path))
        #expect(try Data(contentsOf: destination).prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
    }

    @Test func excludesEveryCurrentProcessApplicationAndUsesFilterScaleMath() throws {
        #expect(
            NativeScreenCaptureClient.excludedApplicationIndices(
                processIDs: [41, 99, 99, 7],
                currentProcessID: 99
            ) == [1, 2]
        )
        let dimensions = try ScreenCaptureController.pixelDimensions(
            logicalSize: CGSize(width: 300, height: 200),
            scaleFactor: 1.5
        )
        #expect(dimensions.width == 450)
        #expect(dimensions.height == 300)
    }

    @Test func refusesExistingDestinationsAndCleansAtomicTemporaryOutput() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fia-capture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let destination = root.appendingPathComponent("shot.png")
        try Data("existing".utf8).write(to: destination)
        let image = try makeImage(width: 2, height: 2)
        let controller = ScreenCaptureController(
            backendDirectory: root,
            screenProvider: MockScreenProvider(values: screens()),
            client: MockScreenCaptureClient(status: .authorized, requested: .authorized, image: image) { _ in }
        )
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "screenCapture.capture", params: [
                "screenId": "11", "destination": destination.path,
            ])
        }
        #expect(try Data(contentsOf: destination) == Data("existing".utf8))
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: root.path)
                .filter { $0.hasSuffix(".tmp") }
                .isEmpty
        )
    }

    @Test func rejectsOverlappingCapturesWithoutTouchingSecondDestination() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fia-capture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let firstDestination = root.appendingPathComponent("first.png")
        let secondDestination = root.appendingPathComponent("second.png")
        let client = BlockingScreenCaptureClient(image: try makeImage(width: 2, height: 2))
        let started = AsyncStream<Void> { continuation in
            client.onStart = { continuation.yield() }
        }
        var iterator = started.makeAsyncIterator()
        let controller = ScreenCaptureController(
            backendDirectory: root,
            screenProvider: MockScreenProvider(values: screens()),
            client: client
        )
        let first = Task { @MainActor () throws -> Void in
            _ = try await controller.execute(method: "screenCapture.capture", params: [
                "screenId": "11", "destination": firstDestination.path,
            ])
        }
        _ = await iterator.next()
        await #expect(throws: HostRequestExecutionError.self) {
            try await controller.execute(method: "screenCapture.capture", params: [
                "screenId": "11", "destination": secondDestination.path,
            ])
        }
        #expect(!FileManager.default.fileExists(atPath: secondDestination.path))
        client.finish()
        try await first.value
        #expect(FileManager.default.fileExists(atPath: firstDestination.path))
    }

    @Test func rejectsDeniedOutOfBoundsAndEscapingCaptures() async throws {
        let image = try makeImage(width: 2, height: 2)
        let denied = ScreenCaptureController(
            backendDirectory: URL(fileURLWithPath: "/tmp"),
            screenProvider: MockScreenProvider(values: screens()),
            client: MockScreenCaptureClient(status: .notAuthorized, requested: .denied, image: image) { _ in }
        )
        await #expect(throws: HostRequestExecutionError.self) {
            try await denied.execute(method: "screenCapture.capture", params: [
                "screenId": "11", "destination": "/tmp/denied.png",
            ])
        }

        let allowed = ScreenCaptureController(
            backendDirectory: URL(fileURLWithPath: "/tmp"),
            screenProvider: MockScreenProvider(values: screens()),
            client: MockScreenCaptureClient(status: .authorized, requested: .authorized, image: image) { _ in }
        )
        await #expect(throws: HostRequestExecutionError.self) {
            try await allowed.execute(method: "screenCapture.capture", params: [
                "screenId": "11",
                "region": ["x": 1400, "y": 0, "width": 100, "height": 100],
                "destination": "/tmp/out.png",
            ])
        }
        await #expect(throws: HostRequestExecutionError.self) {
            try await allowed.execute(method: "screenCapture.capture", params: [
                "screenId": "11", "destination": "/var/tmp/out.png",
            ])
        }
    }

    private func makeImage(width: Int, height: Int) throws -> CGImage {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = try #require(CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.setFillColor(NSColor.systemBlue.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return try #require(context.makeImage())
    }
}
