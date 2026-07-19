import Foundation

public struct DesktopWindowFrame: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var isValid: Bool {
        [x, y, width, height].allSatisfy(\.isFinite) && width > 0 && height > 0
    }
}

public struct DesktopSettings: Codable, Equatable, Sendable {
    public static let schemaVersion = 1

    public let schemaVersion: Int
    public let dockVisible: Bool
    public let statusBarVisible: Bool
    public let statusBarSymbol: String
    public let alwaysOnTop: Bool
    public let visibleOnAllSpaces: Bool
    public let visibleOverFullScreen: Bool
    public let windowFrame: DesktopWindowFrame?

    public init(state: DesktopState, windowFrame: DesktopWindowFrame?) {
        schemaVersion = Self.schemaVersion
        dockVisible = state.dockVisible
        statusBarVisible = state.statusBarVisible
        statusBarSymbol = state.statusBarSymbol
        alwaysOnTop = state.window.alwaysOnTop
        visibleOnAllSpaces = state.window.visibleOnAllSpaces
        visibleOverFullScreen = state.window.visibleOverFullScreen
        self.windowFrame = windowFrame
    }

    public static func decode(_ data: Data, maximumBytes: Int = 64 * 1024) throws -> DesktopSettings {
        guard data.count <= maximumBytes else { throw DesktopSettingsError.fileTooLarge }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw DesktopSettingsError.invalidJSON
        }
        guard let root = object as? [String: Any] else { throw DesktopSettingsError.invalidShape }
        let allowed = Set([
            "schemaVersion", "dockVisible", "statusBarVisible", "statusBarSymbol", "alwaysOnTop",
            "visibleOnAllSpaces", "visibleOverFullScreen", "windowFrame",
        ])
        let required = allowed.subtracting(["windowFrame"])
        guard Set(root.keys).isSubset(of: allowed), required.isSubset(of: Set(root.keys)) else {
            throw DesktopSettingsError.unknownOrMissingFields
        }
        let settings: DesktopSettings
        do {
            settings = try JSONDecoder().decode(DesktopSettings.self, from: data)
        } catch {
            throw DesktopSettingsError.invalidShape
        }
        guard settings.schemaVersion == schemaVersion else {
            throw DesktopSettingsError.unsupportedSchema(settings.schemaVersion)
        }
        guard settings.dockVisible || settings.statusBarVisible,
              !settings.statusBarSymbol.isEmpty,
              settings.statusBarSymbol == settings.statusBarSymbol.trimmingCharacters(in: .whitespacesAndNewlines),
              settings.statusBarSymbol.count <= 128,
              !settings.statusBarSymbol.contains("\0"),
              settings.windowFrame?.isValid != false
        else { throw DesktopSettingsError.invalidShape }
        return settings
    }

    public func applying(to state: DesktopState) throws -> DesktopState {
        var window = state.window
        window.alwaysOnTop = alwaysOnTop
        window.visibleOnAllSpaces = visibleOnAllSpaces
        window.visibleOverFullScreen = visibleOverFullScreen
        let result = try DesktopState(
            dockVisible: dockVisible,
            statusBarVisible: statusBarVisible,
            statusBarSymbol: statusBarSymbol,
            window: window
        )
        return result
    }
}

public enum DesktopSettingsError: Error, Equatable, Sendable {
    case fileTooLarge
    case invalidJSON
    case invalidShape
    case unknownOrMissingFields
    case unsupportedSchema(Int)
}
