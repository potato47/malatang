import Foundation

public struct HostConfiguration: Codable, Equatable, Sendable {
    public struct App: Codable, Equatable, Sendable {
        public enum Mode: String, Codable, Equatable, Sendable {
            case dock
            case statusBar
            case hybrid
        }

        public let name: String
        public let identifier: String
        public let mode: Mode

        public init(name: String, identifier: String, mode: Mode) {
            self.name = name
            self.identifier = identifier
            self.mode = mode
        }
    }

    public struct Window: Codable, Equatable, Sendable {
        public enum CloseBehavior: String, Codable, Equatable, Sendable {
            case quit
            case hide
        }

        public let width: Double
        public let height: Double
        public let minWidth: Double
        public let minHeight: Double
        public let closeBehavior: CloseBehavior
        public let restoreState: Bool
        public let alwaysOnTop: Bool
        public let visibleOnAllSpaces: Bool
        public let visibleOverFullScreen: Bool

        public init(
            width: Double,
            height: Double,
            minWidth: Double,
            minHeight: Double,
            closeBehavior: CloseBehavior,
            restoreState: Bool,
            alwaysOnTop: Bool,
            visibleOnAllSpaces: Bool,
            visibleOverFullScreen: Bool
        ) {
            self.width = width
            self.height = height
            self.minWidth = minWidth
            self.minHeight = minHeight
            self.closeBehavior = closeBehavior
            self.restoreState = restoreState
            self.alwaysOnTop = alwaysOnTop
            self.visibleOnAllSpaces = visibleOnAllSpaces
            self.visibleOverFullScreen = visibleOverFullScreen
        }
    }

    public struct StatusBar: Codable, Equatable, Sendable {
        public let symbol: String
        public let tooltip: String

        public init(symbol: String, tooltip: String) {
            self.symbol = symbol
            self.tooltip = tooltip
        }
    }

    public struct Runtime: Codable, Equatable, Sendable {
        public enum Mode: String, Codable, Equatable, Sendable {
            case production
            case development
            case bundled
        }

        public let mode: Mode
        public let executable: String?
        public let arguments: [String]?
        public let entry: String?

        public init(
            mode: Mode,
            executable: String? = nil,
            arguments: [String]? = nil,
            entry: String? = nil
        ) {
            self.mode = mode
            self.executable = executable
            self.arguments = arguments
            self.entry = entry
        }

        public static let production = Runtime(mode: .production)
        public var isDevelopment: Bool { mode == .development }
        public var isBundled: Bool { mode == .bundled }
    }

    public struct Backend: Codable, Equatable, Sendable {
        public enum Mode: String, Codable, Equatable, Sendable {
            case none
            case production
            case development
        }

        public let mode: Mode
        public let executable: String?

        public init(mode: Mode, executable: String? = nil) {
            self.mode = mode
            self.executable = executable
        }

        public static let none = Backend(mode: .none)
        public var isEnabled: Bool { mode != .none }
        public var isDevelopment: Bool { mode == .development }
    }

    private struct LegacyApp: Codable {
        let name: String
        let identifier: String
        let quitOnLastWindowClosed: Bool
    }

    private struct LegacyWindow: Codable {
        let width: Double
        let height: Double
        let minWidth: Double
        let minHeight: Double
    }

    private struct LegacyConfiguration: Codable {
        let schemaVersion: Int
        let protocolVersion: Int
        let app: LegacyApp
        let window: LegacyWindow
        let runtime: Runtime?
    }

    public let schemaVersion: Int
    public let protocolVersion: Int
    public let app: App
    public let window: Window
    public let statusBar: StatusBar
    public let runtime: Runtime
    public let backend: Backend

    public init(
        schemaVersion: Int,
        protocolVersion: Int,
        app: App,
        window: Window,
        statusBar: StatusBar,
        runtime: Runtime = .production,
        backend: Backend = .none
    ) {
        self.schemaVersion = schemaVersion
        self.protocolVersion = protocolVersion
        self.app = app
        self.window = window
        self.statusBar = statusBar
        self.runtime = runtime
        self.backend = backend
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case protocolVersion
        case app
        case window
        case statusBar
        case runtime
        case backend
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        app = try container.decode(App.self, forKey: .app)
        window = try container.decode(Window.self, forKey: .window)
        statusBar = try container.decode(StatusBar.self, forKey: .statusBar)
        runtime = try container.decode(Runtime.self, forKey: .runtime)
        backend = try container.decodeIfPresent(Backend.self, forKey: .backend) ?? .none
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(protocolVersion, forKey: .protocolVersion)
        try container.encode(app, forKey: .app)
        try container.encode(window, forKey: .window)
        try container.encode(statusBar, forKey: .statusBar)
        try container.encode(runtime, forKey: .runtime)
        if schemaVersion >= 4 { try container.encode(backend, forKey: .backend) }
    }

    public static func load(from url: URL, maximumBytes: Int = 64 * 1024) throws -> HostConfiguration {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        if let size = values.fileSize, size > maximumBytes {
            throw HostConfigurationError.fileTooLarge
        }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return try decode(data, maximumBytes: maximumBytes)
    }

    public static func decode(_ data: Data, maximumBytes: Int = 64 * 1024) throws -> HostConfiguration {
        guard data.count <= maximumBytes else { throw HostConfigurationError.fileTooLarge }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw HostConfigurationError.invalidJSON
        }
        guard let root = object as? [String: Any], let schemaVersion = root["schemaVersion"] as? Int else {
            throw HostConfigurationError.invalidShape
        }

        let configuration: HostConfiguration
        do {
            switch schemaVersion {
            case 1, 2:
                configuration = try decodeLegacy(data, root: root, schemaVersion: schemaVersion)
            case 3:
                configuration = try decodeCurrent(data, root: root)
            case 4:
                configuration = try decodeSchemaFour(data, root: root)
            default:
                throw HostConfigurationError.unsupportedSchema(schemaVersion)
            }
        } catch let error as HostConfigurationError {
            throw error
        } catch {
            throw HostConfigurationError.invalidShape
        }
        try configuration.validate()
        return configuration
    }

    private static func decodeLegacy(
        _ data: Data,
        root: [String: Any],
        schemaVersion: Int
    ) throws -> HostConfiguration {
        let expectedRoot = schemaVersion == 1
            ? Set(["schemaVersion", "protocolVersion", "app", "window"])
            : Set(["schemaVersion", "protocolVersion", "app", "window", "runtime"])
        try requireExactKeys(root, expected: expectedRoot, at: "root")
        guard let appObject = root["app"] as? [String: Any],
              let windowObject = root["window"] as? [String: Any]
        else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(appObject, expected: ["name", "identifier", "quitOnLastWindowClosed"], at: "app")
        try requireExactKeys(windowObject, expected: ["width", "height", "minWidth", "minHeight"], at: "window")
        if schemaVersion == 2 {
            try validateRuntimeShape(root["runtime"])
        }
        let legacy = try JSONDecoder().decode(LegacyConfiguration.self, from: data)
        let closeBehavior: Window.CloseBehavior = legacy.app.quitOnLastWindowClosed ? .quit : .hide
        return HostConfiguration(
            schemaVersion: schemaVersion,
            protocolVersion: legacy.protocolVersion,
            app: App(name: legacy.app.name, identifier: legacy.app.identifier, mode: .dock),
            window: Window(
                width: legacy.window.width,
                height: legacy.window.height,
                minWidth: legacy.window.minWidth,
                minHeight: legacy.window.minHeight,
                closeBehavior: closeBehavior,
                restoreState: false,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            ),
            statusBar: StatusBar(symbol: "circle.grid.2x2.fill", tooltip: legacy.app.name),
            runtime: legacy.runtime ?? .production
        )
    }

    private static func decodeCurrent(_ data: Data, root: [String: Any]) throws -> HostConfiguration {
        try requireExactKeys(
            root,
            expected: ["schemaVersion", "protocolVersion", "app", "window", "statusBar", "runtime"],
            at: "root"
        )
        guard let appObject = root["app"] as? [String: Any],
              let windowObject = root["window"] as? [String: Any],
              let statusBarObject = root["statusBar"] as? [String: Any]
        else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(appObject, expected: ["name", "identifier", "mode"], at: "app")
        try requireExactKeys(
            windowObject,
            expected: [
                "width", "height", "minWidth", "minHeight", "closeBehavior", "restoreState",
                "alwaysOnTop", "visibleOnAllSpaces", "visibleOverFullScreen",
            ],
            at: "window"
        )
        try requireExactKeys(statusBarObject, expected: ["symbol", "tooltip"], at: "statusBar")
        try validateRuntimeShape(root["runtime"])
        return try JSONDecoder().decode(HostConfiguration.self, from: data)
    }

    private static func decodeSchemaFour(_ data: Data, root: [String: Any]) throws -> HostConfiguration {
        try requireExactKeys(
            root,
            expected: ["schemaVersion", "protocolVersion", "app", "window", "statusBar", "runtime", "backend"],
            at: "root"
        )
        guard let appObject = root["app"] as? [String: Any],
              let windowObject = root["window"] as? [String: Any],
              let statusBarObject = root["statusBar"] as? [String: Any]
        else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(appObject, expected: ["name", "identifier", "mode"], at: "app")
        try requireExactKeys(
            windowObject,
            expected: [
                "width", "height", "minWidth", "minHeight", "closeBehavior", "restoreState",
                "alwaysOnTop", "visibleOnAllSpaces", "visibleOverFullScreen",
            ],
            at: "window"
        )
        try requireExactKeys(statusBarObject, expected: ["symbol", "tooltip"], at: "statusBar")
        try validateRuntimeShape(root["runtime"])
        try validateBackendShape(root["backend"])
        return try JSONDecoder().decode(HostConfiguration.self, from: data)
    }

    private static func validateBackendShape(_ value: Any?) throws {
        guard let object = value as? [String: Any], let mode = object["mode"] as? String else {
            throw HostConfigurationError.invalidBackend
        }
        switch mode {
        case Backend.Mode.none.rawValue, Backend.Mode.production.rawValue:
            try requireExactKeys(object, expected: ["mode"], at: "backend")
        case Backend.Mode.development.rawValue:
            try requireExactKeys(object, expected: ["mode", "executable"], at: "backend")
        default:
            throw HostConfigurationError.invalidBackend
        }
    }

    private static func validateRuntimeShape(_ value: Any?) throws {
        guard let runtimeObject = value as? [String: Any], let mode = runtimeObject["mode"] as? String else {
            throw HostConfigurationError.invalidShape
        }
        switch mode {
        case Runtime.Mode.production.rawValue:
            try requireExactKeys(runtimeObject, expected: ["mode"], at: "runtime")
        case Runtime.Mode.bundled.rawValue:
            try requireExactKeys(runtimeObject, expected: ["mode", "entry"], at: "runtime")
        case Runtime.Mode.development.rawValue:
            try requireExactKeys(runtimeObject, expected: ["mode", "executable", "arguments"], at: "runtime")
        default:
            throw HostConfigurationError.invalidRuntime
        }
    }

    private func validate() throws {
        guard (1...4).contains(schemaVersion) else {
            throw HostConfigurationError.unsupportedSchema(schemaVersion)
        }
        guard protocolVersion == 1 else { throw HostConfigurationError.unsupportedProtocol(protocolVersion) }
        guard !app.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw HostConfigurationError.invalidApplicationName
        }
        let identifierPattern = #"^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$"#
        guard app.identifier.range(of: identifierPattern, options: .regularExpression) != nil else {
            throw HostConfigurationError.invalidBundleIdentifier
        }
        let dimensions = [window.width, window.height, window.minWidth, window.minHeight]
        guard dimensions.allSatisfy({ $0.isFinite && $0 > 0 }),
              window.width >= window.minWidth,
              window.height >= window.minHeight
        else { throw HostConfigurationError.invalidWindowDimensions }
        guard !statusBar.symbol.isEmpty,
              statusBar.symbol == statusBar.symbol.trimmingCharacters(in: .whitespacesAndNewlines),
              statusBar.symbol.count <= 128,
              !statusBar.symbol.contains("\0"),
              !statusBar.tooltip.isEmpty,
              statusBar.tooltip == statusBar.tooltip.trimmingCharacters(in: .whitespacesAndNewlines),
              statusBar.tooltip.count <= 512,
              !statusBar.tooltip.contains("\0")
        else { throw HostConfigurationError.invalidStatusBar }
        switch runtime.mode {
        case .production:
            guard runtime.executable == nil, runtime.arguments == nil, runtime.entry == nil else {
                throw HostConfigurationError.invalidRuntime
            }
        case .bundled:
            let entryComponents = runtime.entry?.split(separator: "/", omittingEmptySubsequences: false) ?? []
            guard runtime.executable == nil,
                  runtime.arguments == nil,
                  let entry = runtime.entry,
                  !entry.isEmpty,
                  !entry.hasPrefix("/"),
                  !entry.contains("\0"),
                  entryComponents.count >= 2,
                  entryComponents.first == "UI",
                  !entryComponents.contains(""),
                  !entryComponents.contains("."),
                  !entryComponents.contains("..")
            else {
                throw HostConfigurationError.invalidRuntime
            }
        case .development:
            guard schemaVersion >= 2,
                  let executable = runtime.executable,
                  NSString(string: executable).isAbsolutePath,
                  !executable.contains("\0"),
                  let arguments = runtime.arguments,
                  !arguments.isEmpty,
                  arguments.count <= 128,
                  arguments.allSatisfy({ !$0.isEmpty && !$0.contains("\0") }),
                  runtime.entry == nil
            else { throw HostConfigurationError.invalidRuntime }
        }
        switch backend.mode {
        case .none, .production:
            guard backend.executable == nil else { throw HostConfigurationError.invalidBackend }
        case .development:
            guard schemaVersion >= 4,
                  let executable = backend.executable,
                  NSString(string: executable).isAbsolutePath,
                  !executable.contains("\0")
            else { throw HostConfigurationError.invalidBackend }
        }
        if schemaVersion < 4, backend != .none { throw HostConfigurationError.invalidBackend }
        if backend.mode == .production, runtime.mode != .bundled { throw HostConfigurationError.invalidBackend }
        if backend.mode == .development, runtime.mode != .development { throw HostConfigurationError.invalidBackend }
    }

    private static func requireExactKeys(
        _ object: [String: Any],
        expected: Set<String>,
        at path: String
    ) throws {
        guard Set(object.keys) == expected else {
            throw HostConfigurationError.unknownOrMissingFields(path: path)
        }
    }
}

public enum HostConfigurationError: Error, Equatable, LocalizedError, Sendable {
    case fileTooLarge
    case invalidJSON
    case invalidShape
    case unknownOrMissingFields(path: String)
    case unsupportedSchema(Int)
    case unsupportedProtocol(Int)
    case invalidApplicationName
    case invalidBundleIdentifier
    case invalidWindowDimensions
    case invalidStatusBar
    case invalidRuntime
    case invalidBackend

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge: "fia-config.json exceeds 64 KiB"
        case .invalidJSON: "fia-config.json is not valid JSON"
        case .invalidShape: "fia-config.json contains invalid value types"
        case let .unknownOrMissingFields(path): "fia-config.json has unknown or missing fields at \(path)"
        case let .unsupportedSchema(version): "Unsupported configuration schema \(version)"
        case let .unsupportedProtocol(version): "Unsupported runtime protocol \(version)"
        case .invalidApplicationName: "Application name must not be empty"
        case .invalidBundleIdentifier: "Application identifier is invalid"
        case .invalidWindowDimensions: "Window dimensions are invalid"
        case .invalidStatusBar: "Status bar configuration is invalid"
        case .invalidRuntime: "Runtime launch configuration is invalid"
        case .invalidBackend: "Swift backend launch configuration is invalid"
        }
    }
}
