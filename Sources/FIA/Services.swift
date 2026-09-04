import AppKit
import CoreGraphics
import FIAMacOS
import Foundation
import ScreenCaptureKit
import Security
import UserNotifications

@MainActor
public final class ClipboardService {
    private let pasteboard: NSPasteboard
    public init(pasteboard: NSPasteboard = .general) { self.pasteboard = pasteboard }
    public func readText() -> String? { pasteboard.string(forType: .string) }
    @discardableResult public func writeText(_ value: String) -> Bool {
        pasteboard.clearContents()
        return pasteboard.setString(value, forType: .string)
    }
    public func clear() { pasteboard.clearContents() }
}

@MainActor
public final class DialogService {
    public init() {}
    public func openFiles(allowsMultipleSelection: Bool = false) async -> [URL]? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = allowsMultipleSelection
        return await withCheckedContinuation { continuation in
            panel.begin { continuation.resume(returning: $0 == .OK ? panel.urls : nil) }
        }
    }
    public func saveFile(suggestedName: String? = nil) async -> URL? {
        let panel = NSSavePanel()
        if let suggestedName { panel.nameFieldStringValue = suggestedName }
        return await withCheckedContinuation { continuation in
            panel.begin { continuation.resume(returning: $0 == .OK ? panel.url : nil) }
        }
    }
}

public final class KeychainService: Sendable {
    private let service: String
    public init(service: String) { self.service = service }

    public func value(for key: String) throws -> String? {
        var query = base(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw FIAError(code: .nativeFailure, component: "keychain", method: "get", message: "Keychain read failed (\(status))")
        }
        return value
    }

    public func set(_ value: String, for key: String) throws {
        let query = base(key)
        let values: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if update == errSecItemNotFound {
            var item = query
            for (key, value) in values { item[key] = value }
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess else {
                throw FIAError(code: .nativeFailure, component: "keychain", method: "set", message: "Keychain write failed (\(status))")
            }
        } else if update != errSecSuccess {
            throw FIAError(code: .nativeFailure, component: "keychain", method: "set", message: "Keychain write failed (\(update))")
        }
    }

    @discardableResult
    public func delete(_ key: String) throws -> Bool {
        let status = SecItemDelete(base(key) as CFDictionary)
        if status == errSecItemNotFound { return false }
        guard status == errSecSuccess else {
            throw FIAError(code: .nativeFailure, component: "keychain", method: "delete", message: "Keychain delete failed (\(status))")
        }
        return true
    }

    private func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }
}

@MainActor
public final class NotificationService {
    public init() {}
    public func requestAuthorization() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }
    public func deliver(title: String, body: String) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

public struct ScreenDescriptor: Codable, Sendable, Equatable {
    public let id: UInt32
    public let name: String
    public let frame: CGRect
    public let visibleFrame: CGRect
    public let scaleFactor: Double
    public let main: Bool
}

@MainActor
public final class ScreenService {
    public init() {}
    public func screens() -> [ScreenDescriptor] {
        let primary = NSScreen.screens.first
        return NSScreen.screens.compactMap { screen in
            guard let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { return nil }
            return ScreenDescriptor(
                id: id,
                name: screen.localizedName,
                frame: screen.frame,
                visibleFrame: screen.visibleFrame,
                scaleFactor: screen.backingScaleFactor,
                main: screen === primary
            )
        }
    }
}

@MainActor
public final class SystemService {
    private let workspace: NSWorkspace
    public init(workspace: NSWorkspace = .shared) { self.workspace = workspace }
    @discardableResult public func open(_ url: URL) -> Bool { workspace.open(url) }
    public func reveal(_ file: URL) { workspace.activateFileViewerSelecting([file]) }
}

@MainActor
public final class ShortcutService {
    public struct Shortcut: Codable, Sendable, Equatable {
        public let id: String
        public let key: String
        public let modifiers: [String]

        public init(id: String, key: String, modifiers: [String]) {
            self.id = id
            self.key = key
            self.modifiers = modifiers
        }
    }

    public var onPressed: ((String) -> Void)?
    private let adapter = FIAGlobalShortcutAdapter()

    public init() {
        adapter.onPressed = { [weak self] id in self?.onPressed?(id) }
    }

    public func set(_ shortcuts: [Shortcut]) throws {
        try adapter.replace(with: shortcuts.map {
            FIAGlobalShortcutDefinition(id: $0.id, key: $0.key, modifiers: $0.modifiers)
        })
    }

    public func clear() { adapter.clear() }
}

@MainActor
public final class ScreenCaptureService {
    private var selecting = false

    public init() {}
    public var isAuthorized: Bool { CGPreflightScreenCaptureAccess() }

    public func requestAuthorization() -> Bool { CGRequestScreenCaptureAccess() }

    public func captureRegion(
        resources: ResourceStore,
        session: String,
        origin: URL
    ) async throws -> NativeResource {
        guard !selecting else {
            throw FIAError(code: .conflict, component: "screen", method: "captureRegion", message: "A region selection is already active", recoverable: true)
        }
        guard isAuthorized else {
            throw FIAError(code: .permissionDenied, component: "screen", method: "captureRegion", message: "Screen Recording permission is required", recoverable: true)
        }
        selecting = true
        defer { selecting = false }
        let selection = try await RegionSelector.select()
        try Task.checkCancellation()
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let screen = NSScreen.screens.first(where: { $0.frame.intersects(selection) }),
              let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value,
              let display = content.displays.first(where: { $0.displayID == id })
        else {
            throw FIAError(code: .notFound, component: "screen", method: "captureRegion", message: "The selected screen is no longer available")
        }
        let clipped = selection.intersection(screen.frame)
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = CGRect(
            x: clipped.minX - screen.frame.minX,
            y: screen.frame.maxY - clipped.maxY,
            width: clipped.width,
            height: clipped.height
        )
        configuration.width = max(1, Int(clipped.width * CGFloat(filter.pointPixelScale)))
        configuration.height = max(1, Int(clipped.height * CGFloat(filter.pointPixelScale)))
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let representation = NSBitmapImageRep(cgImage: image)
        guard let png = representation.representation(using: .png, properties: [:]) else {
            throw FIAError(code: .nativeFailure, component: "screen", method: "captureRegion", message: "Could not encode the captured image")
        }
        return try await resources.create(data: png, contentType: "image/png", session: session, origin: origin)
    }
}

@MainActor
private final class RegionSelector: NSView {
    private static var active: RegionSelector?
    private let windowReference: NSWindow
    private var start: CGPoint?
    private var current: CGPoint?
    private var continuation: CheckedContinuation<CGRect, Error>?
    private var keyMonitor: Any?

    static func select() async throws -> CGRect {
        guard active == nil else { throw FIAError(code: .conflict, component: "screen", method: "captureRegion", message: "A region selector is already active") }
        let union = NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
        let window = NSWindow(contentRect: union, styleMask: .borderless, backing: .buffered, defer: false)
        let selector = RegionSelector(window: window, frame: CGRect(origin: .zero, size: union.size))
        active = selector
        window.level = .screenSaver
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.ignoresMouseEvents = false
        window.contentView = selector
        window.makeKeyAndOrderFront(nil)
        NSCursor.crosshair.push()
        defer { active = nil; NSCursor.pop() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { selector.continuation = $0 }
        } onCancel: {
            Task { @MainActor in selector.finish(.failure(CancellationError())) }
        }
    }

    init(window: NSWindow, frame: CGRect) {
        windowReference = window
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.18).cgColor
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 { self?.finish(.failure(CancellationError())); return nil }
            return event
        }
    }

    required init?(coder: NSCoder) { nil }

    override func mouseDown(with event: NSEvent) { start = convert(event.locationInWindow, from: nil); current = start; needsDisplay = true }
    override func mouseDragged(with event: NSEvent) { current = convert(event.locationInWindow, from: nil); needsDisplay = true }
    override func mouseUp(with event: NSEvent) {
        guard let start else { return }
        let end = convert(event.locationInWindow, from: nil)
        let local = CGRect(x: min(start.x, end.x), y: min(start.y, end.y), width: abs(end.x - start.x), height: abs(end.y - start.y))
        guard local.width >= 2, local.height >= 2 else { finish(.failure(CancellationError())); return }
        let screenOrigin = windowReference.frame.origin
        finish(.success(local.offsetBy(dx: screenOrigin.x, dy: screenOrigin.y)))
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let start, let current else { return }
        let selection = CGRect(x: min(start.x, current.x), y: min(start.y, current.y), width: abs(current.x - start.x), height: abs(current.y - start.y))
        NSColor.clear.setFill()
        selection.fill(using: .copy)
        NSColor.controlAccentColor.setStroke()
        let path = NSBezierPath(rect: selection)
        path.lineWidth = 2
        path.stroke()
    }

    func finish(_ result: Result<CGRect, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor); self.keyMonitor = nil }
        windowReference.orderOut(nil)
        windowReference.close()
        continuation.resume(with: result)
    }
}
