import Foundation

public struct DesktopWindowState: Codable, Equatable, Sendable {
    public var visible: Bool
    public var focused: Bool
    public var alwaysOnTop: Bool
    public var visibleOnAllSpaces: Bool
    public var visibleOverFullScreen: Bool

    public init(
        visible: Bool,
        focused: Bool,
        alwaysOnTop: Bool,
        visibleOnAllSpaces: Bool,
        visibleOverFullScreen: Bool
    ) {
        self.visible = visible
        self.focused = focused
        self.alwaysOnTop = alwaysOnTop
        self.visibleOnAllSpaces = visibleOnAllSpaces
        self.visibleOverFullScreen = visibleOverFullScreen
    }
}

public struct DesktopState: Encodable, Equatable, Sendable {
    public enum Mode: String, Codable, Equatable, Sendable {
        case dock
        case statusBar
        case hybrid
    }

    public var dockVisible: Bool
    public var statusBarVisible: Bool
    public var statusBarSymbol: String
    public var window: DesktopWindowState

    public var mode: Mode {
        if dockVisible && statusBarVisible { return .hybrid }
        if dockVisible { return .dock }
        return .statusBar
    }

    public init(
        dockVisible: Bool,
        statusBarVisible: Bool,
        statusBarSymbol: String,
        window: DesktopWindowState
    ) throws {
        guard dockVisible || statusBarVisible else { throw DesktopStateError.missingRecoveryEntry }
        self.dockVisible = dockVisible
        self.statusBarVisible = statusBarVisible
        self.statusBarSymbol = statusBarSymbol
        self.window = window
    }

    public init(configuration: HostConfiguration) {
        dockVisible = configuration.app.mode != .statusBar
        statusBarVisible = configuration.app.mode != .dock
        statusBarSymbol = configuration.statusBar.symbol
        window = DesktopWindowState(
            visible: true,
            focused: false,
            alwaysOnTop: configuration.window.alwaysOnTop,
            visibleOnAllSpaces: configuration.window.visibleOnAllSpaces,
            visibleOverFullScreen: configuration.window.visibleOverFullScreen
        )
    }

    public mutating func setDockVisible(_ visible: Bool) throws {
        guard visible || statusBarVisible else { throw DesktopStateError.missingRecoveryEntry }
        dockVisible = visible
    }

    public mutating func setStatusBarVisible(_ visible: Bool) throws {
        guard visible || dockVisible else { throw DesktopStateError.missingRecoveryEntry }
        statusBarVisible = visible
    }

    private enum CodingKeys: String, CodingKey {
        case mode
        case dockVisible
        case statusBarVisible
        case statusBarSymbol
        case window
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(mode, forKey: .mode)
        try container.encode(dockVisible, forKey: .dockVisible)
        try container.encode(statusBarVisible, forKey: .statusBarVisible)
        try container.encode(statusBarSymbol, forKey: .statusBarSymbol)
        try container.encode(window, forKey: .window)
    }
}

public enum DesktopStateError: Error, Equatable, LocalizedError, Sendable {
    case missingRecoveryEntry

    public var errorDescription: String? {
        switch self {
        case .missingRecoveryEntry:
            "Dock and status bar cannot both be hidden"
        }
    }
}
