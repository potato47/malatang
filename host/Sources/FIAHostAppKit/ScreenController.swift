import AppKit
import CoreGraphics
import FIAHostCore
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct HostScreenDescriptor: Equatable, Sendable {
    let id: UInt32
    let name: String
    let frame: CGRect
    let visibleFrame: CGRect
    let scaleFactor: Double
    let main: Bool
}

@MainActor
protocol ScreenProvider {
    func screens() -> [HostScreenDescriptor]
    func pointerLocation() -> CGPoint
}

@MainActor
struct NativeScreenProvider: ScreenProvider {
    func screens() -> [HostScreenDescriptor] {
        let primary = NSScreen.screens.first
        return NSScreen.screens.compactMap { screen in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return nil
            }
            return HostScreenDescriptor(
                id: number.uint32Value,
                name: screen.localizedName,
                frame: screen.frame,
                visibleFrame: screen.visibleFrame,
                scaleFactor: Double(screen.backingScaleFactor),
                main: screen === primary
            )
        }
    }

    func pointerLocation() -> CGPoint { NSEvent.mouseLocation }
}

@MainActor
final class ScreensController {
    private let provider: ScreenProvider

    init(provider: ScreenProvider = NativeScreenProvider()) { self.provider = provider }

    func execute(method: String, params: [String: Any]) throws -> Any? {
        guard method == "screens.list" else {
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown screens method: \(method)")
        }
        guard params.isEmpty else { throw invalid("screens.list does not accept parameters") }
        let screens = provider.screens()
        guard let primary = screens.first(where: \.main) ?? screens.first else { return [] }
        let pointer = provider.pointerLocation()
        return screens.map { screen in
            [
                "id": String(screen.id),
                "name": screen.name,
                "frame": Self.publicRect(screen.frame, primaryFrame: primary.frame),
                "visibleFrame": Self.publicRect(screen.visibleFrame, primaryFrame: primary.frame),
                "scaleFactor": screen.scaleFactor,
                "main": screen.main,
                "containsPointer": screen.frame.contains(pointer),
            ] as [String: Any]
        }
    }

    static func publicRect(_ rect: CGRect, primaryFrame: CGRect) -> [String: Double] {
        [
            "x": Double(rect.minX - primaryFrame.minX),
            "y": Double(primaryFrame.maxY - rect.maxY),
            "width": Double(rect.width),
            "height": Double(rect.height),
        ]
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}

enum ScreenCaptureAuthorization: String, Sendable {
    case notAuthorized
    case authorized
}

enum ScreenCaptureAuthorizationRequest: String, Sendable {
    case authorized
    case restartRequired
    case denied
}

struct ScreenCaptureRequest: Sendable {
    let screenID: UInt32
    let sourceRect: CGRect?
    let pixelWidth: Int
    let pixelHeight: Int
    let showsCursor: Bool
}

@MainActor
protocol ScreenCaptureClient {
    func authorizationStatus() -> ScreenCaptureAuthorization
    func requestAuthorization() -> ScreenCaptureAuthorizationRequest
    func capture(_ request: ScreenCaptureRequest) async throws -> CGImage
}

@MainActor
struct NativeScreenCaptureClient: ScreenCaptureClient {
    private let preflightAuthorization: () -> Bool
    private let requestAccess: () -> Bool

    init(
        preflightAuthorization: @escaping () -> Bool = { CGPreflightScreenCaptureAccess() },
        requestAccess: @escaping () -> Bool = { CGRequestScreenCaptureAccess() }
    ) {
        self.preflightAuthorization = preflightAuthorization
        self.requestAccess = requestAccess
    }

    func authorizationStatus() -> ScreenCaptureAuthorization {
        preflightAuthorization() ? .authorized : .notAuthorized
    }

    func requestAuthorization() -> ScreenCaptureAuthorizationRequest {
        if preflightAuthorization() { return .authorized }
        guard requestAccess() else { return .denied }
        return preflightAuthorization() ? .authorized : .restartRequired
    }

    func capture(_ request: ScreenCaptureRequest) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == request.screenID }) else {
            throw HostRequestExecutionError(code: .notFound, message: "screen is no longer available")
        }
        let processID = ProcessInfo.processInfo.processIdentifier
        let excludedIndices = Self.excludedApplicationIndices(
            processIDs: content.applications.map(\.processID),
            currentProcessID: processID
        )
        let excluded = excludedIndices.map { content.applications[$0] }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        let logicalSize = request.sourceRect?.size
            ?? CGSize(width: display.width, height: display.height)
        let dimensions = try ScreenCaptureController.pixelDimensions(
            logicalSize: logicalSize,
            scaleFactor: Double(filter.pointPixelScale)
        )
        configuration.width = dimensions.width
        configuration.height = dimensions.height
        configuration.showsCursor = request.showsCursor
        if let sourceRect = request.sourceRect { configuration.sourceRect = sourceRect }
        return try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: configuration
        )
    }

    static func excludedApplicationIndices(
        processIDs: [pid_t],
        currentProcessID: pid_t
    ) -> [Int] {
        processIDs.indices.filter { processIDs[$0] == currentProcessID }
    }
}

@MainActor
final class ScreenCaptureController {
    private let backendDirectory: URL
    private let screenProvider: ScreenProvider
    private let client: ScreenCaptureClient
    private let fileManager: FileManager
    private var requestingAuthorization = false
    private var capturing = false

    init(
        backendDirectory: URL,
        screenProvider: ScreenProvider = NativeScreenProvider(),
        client: ScreenCaptureClient = NativeScreenCaptureClient(),
        fileManager: FileManager = .default
    ) {
        self.backendDirectory = backendDirectory.standardizedFileURL.resolvingSymlinksInPath()
        self.screenProvider = screenProvider
        self.client = client
        self.fileManager = fileManager
    }

    func execute(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "screenCapture.getAuthorizationStatus":
            try requireKeys(params, allowed: [])
            return client.authorizationStatus().rawValue
        case "screenCapture.requestAuthorization":
            try requireKeys(params, allowed: [])
            guard !requestingAuthorization else { throw conflict("screen capture authorization is already in progress") }
            requestingAuthorization = true
            defer { requestingAuthorization = false }
            return client.requestAuthorization().rawValue
        case "screenCapture.capture":
            try requireKeys(params, allowed: ["screenId", "region", "destination", "showsCursor"])
            guard !capturing else { throw conflict("a screen capture is already in progress") }
            guard client.authorizationStatus() == .authorized else {
                throw HostRequestExecutionError(
                    code: .permissionDenied,
                    message: "screen recording permission has not been granted"
                )
            }
            let request = try captureRequest(params)
            let destination = try destination(params["destination"])
            capturing = true
            defer { capturing = false }
            let image: CGImage
            do {
                image = try await client.capture(request)
                try Task.checkCancellation()
                try writePNG(image, destination: destination)
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as HostRequestExecutionError {
                throw error
            } catch {
                if client.authorizationStatus() == .notAuthorized {
                    throw HostRequestExecutionError(
                        code: .permissionDenied,
                        message: "screen recording permission has not been granted"
                    )
                }
                throw HostRequestExecutionError(
                    code: .nativeFailure,
                    message: "screen capture failed: \(error.localizedDescription)"
                )
            }
            let attributes = try fileManager.attributesOfItem(atPath: destination.path)
            guard let byteSize = attributes[.size] as? NSNumber, byteSize.intValue > 0 else {
                try? fileManager.removeItem(at: destination)
                throw HostRequestExecutionError(
                    code: .nativeFailure,
                    message: "captured PNG has an invalid file size"
                )
            }
            return [
                "path": destination.path,
                "byteSize": byteSize.intValue,
                "pixelWidth": image.width,
                "pixelHeight": image.height,
            ]
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown screen capture method: \(method)")
        }
    }

    private func captureRequest(_ params: [String: Any]) throws -> ScreenCaptureRequest {
        guard let idValue = params["screenId"] as? String, let screenID = UInt32(idValue),
              let screen = screenProvider.screens().first(where: { $0.id == screenID }) else {
            throw HostRequestExecutionError(code: .notFound, message: "screen was not found")
        }
        let scale = screen.scaleFactor
        guard scale.isFinite, scale > 0 else {
            throw HostRequestExecutionError(code: .nativeFailure, message: "screen has an invalid scale factor")
        }
        let region = try optionalRegion(params["region"], screen: screen)
        let logicalWidth = region?.width ?? screen.frame.width
        let logicalHeight = region?.height ?? screen.frame.height
        let dimensions = try Self.pixelDimensions(
            logicalSize: CGSize(width: logicalWidth, height: logicalHeight),
            scaleFactor: scale
        )
        return ScreenCaptureRequest(
            screenID: screenID,
            sourceRect: region,
            pixelWidth: dimensions.width,
            pixelHeight: dimensions.height,
            showsCursor: try optionalBool(params["showsCursor"], field: "showsCursor") ?? false
        )
    }

    static func pixelDimensions(
        logicalSize: CGSize,
        scaleFactor: Double
    ) throws -> (width: Int, height: Int) {
        let rawPixelWidth = (logicalSize.width * scaleFactor).rounded()
        let rawPixelHeight = (logicalSize.height * scaleFactor).rounded()
        guard scaleFactor.isFinite, scaleFactor > 0,
              rawPixelWidth.isFinite, rawPixelHeight.isFinite,
              rawPixelWidth <= Double(Int.max), rawPixelHeight <= Double(Int.max) else {
            throw HostRequestExecutionError(code: .nativeFailure, message: "screen capture dimensions are invalid")
        }
        let width = Int(rawPixelWidth)
        let height = Int(rawPixelHeight)
        guard width > 0, height > 0 else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "capture region is empty")
        }
        return (width, height)
    }

    private func optionalRegion(_ value: Any?, screen: HostScreenDescriptor) throws -> CGRect? {
        guard let value else { return nil }
        guard let region = value as? [String: Any], Set(region.keys) == ["x", "y", "width", "height"] else {
            throw invalid("region must contain x, y, width, and height")
        }
        let x = try number(region["x"], field: "region.x", positive: false)
        let y = try number(region["y"], field: "region.y", positive: false)
        let width = try number(region["width"], field: "region.width", positive: true)
        let height = try number(region["height"], field: "region.height", positive: true)
        let rect = CGRect(x: x, y: y, width: width, height: height)
        let bounds = CGRect(x: 0, y: 0, width: screen.frame.width, height: screen.frame.height)
        guard bounds.contains(rect) else { throw invalid("region must stay inside the selected screen") }
        return rect
    }

    private func destination(_ value: Any?) throws -> URL {
        guard let path = value as? String, path.hasPrefix("/"), !path.contains("\0") else {
            throw invalid("destination must be an absolute POSIX path")
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.pathExtension.lowercased() == "png" else { throw invalid("destination must have a .png extension") }
        let parent = url.deletingLastPathComponent().resolvingSymlinksInPath()
        guard parent == backendDirectory || parent.path.hasPrefix(backendDirectory.path + "/") else {
            throw HostRequestExecutionError(
                code: .permissionDenied,
                message: "destination must stay inside the Backend data directory"
            )
        }
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw invalid("destination parent directory must exist")
        }
        if fileManager.fileExists(atPath: url.path) {
            throw conflict("destination already exists")
        }
        return url
    }

    private func writePNG(_ image: CGImage, destination: URL) throws {
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        defer { try? fileManager.removeItem(at: temporary) }
        guard let writer = CGImageDestinationCreateWithURL(
            temporary as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else { throw HostRequestExecutionError(code: .nativeFailure, message: "could not create PNG writer") }
        CGImageDestinationAddImage(writer, image, nil)
        guard CGImageDestinationFinalize(writer) else {
            throw HostRequestExecutionError(code: .nativeFailure, message: "could not encode PNG image")
        }
        try fileManager.moveItem(at: temporary, to: destination)
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("screen capture parameters contain unknown fields")
        }
    }

    private func optionalBool(_ value: Any?, field: String) throws -> Bool? {
        guard let value else { return nil }
        guard let value = value as? Bool else { throw invalid("\(field) must be a boolean") }
        return value
    }

    private func number(_ value: Any?, field: String, positive: Bool) throws -> Double {
        guard let value = value as? NSNumber, !value.isJSONBoolean, value.doubleValue.isFinite,
              positive ? value.doubleValue > 0 : value.doubleValue >= 0 else {
            throw invalid("\(field) must be a \(positive ? "positive" : "non-negative") finite number")
        }
        return value.doubleValue
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }

    private func conflict(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .conflict, message: message)
    }
}
