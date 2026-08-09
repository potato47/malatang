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

public struct HostSettings: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 2

    public let schemaVersion: Int
    public var dockVisible: Bool
    public var statusItemVisible: Bool
    public var statusItemSymbol: String
    public var windowFrames: [String: DesktopWindowFrame]

    public init(
        schemaVersion: Int = HostSettings.currentSchemaVersion,
        dockVisible: Bool = false,
        statusItemVisible: Bool = true,
        statusItemSymbol: String,
        windowFrames: [String: DesktopWindowFrame] = [:]
    ) {
        self.schemaVersion = schemaVersion
        self.dockVisible = dockVisible
        self.statusItemVisible = statusItemVisible
        self.statusItemSymbol = statusItemSymbol
        self.windowFrames = windowFrames
    }

    public static func decode(_ data: Data, maximumBytes: Int = 64 * 1024) throws -> HostSettings {
        guard data.count <= maximumBytes else { throw HostSettingsError.fileTooLarge }
        let settings: HostSettings
        do {
            settings = try JSONDecoder().decode(HostSettings.self, from: data)
        } catch {
            throw HostSettingsError.invalidShape
        }
        guard settings.schemaVersion == currentSchemaVersion else {
            throw HostSettingsError.unsupportedSchema(settings.schemaVersion)
        }
        guard settings.dockVisible || settings.statusItemVisible,
              !settings.statusItemSymbol.isEmpty,
              settings.statusItemSymbol.count <= 128,
              settings.windowFrames.keys.allSatisfy({ !$0.isEmpty && !$0.contains("\0") }),
              settings.windowFrames.values.allSatisfy(\.isValid)
        else { throw HostSettingsError.invalidShape }
        return settings
    }
}

public enum HostSettingsError: Error, Equatable, Sendable {
    case fileTooLarge
    case invalidShape
    case unsupportedSchema(Int)
}
