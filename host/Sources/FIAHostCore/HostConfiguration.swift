import Foundation

public struct HostConfiguration: Codable, Equatable, Sendable {
    public struct App: Codable, Equatable, Sendable {
        public let name: String
        public let identifier: String
        public let quitOnLastWindowClosed: Bool

        public init(name: String, identifier: String, quitOnLastWindowClosed: Bool) {
            self.name = name
            self.identifier = identifier
            self.quitOnLastWindowClosed = quitOnLastWindowClosed
        }
    }

    public struct Window: Codable, Equatable, Sendable {
        public let width: Double
        public let height: Double
        public let minWidth: Double
        public let minHeight: Double

        public init(width: Double, height: Double, minWidth: Double, minHeight: Double) {
            self.width = width
            self.height = height
            self.minWidth = minWidth
            self.minHeight = minHeight
        }
    }

    public struct Runtime: Codable, Equatable, Sendable {
        public enum Mode: String, Codable, Equatable, Sendable {
            case production
            case development
        }

        public let mode: Mode
        public let executable: String?
        public let arguments: [String]?

        public init(mode: Mode, executable: String? = nil, arguments: [String]? = nil) {
            self.mode = mode
            self.executable = executable
            self.arguments = arguments
        }

        public static let production = Runtime(mode: .production)
        public var isDevelopment: Bool { mode == .development }
    }

    private struct LegacyConfiguration: Codable {
        let schemaVersion: Int
        let protocolVersion: Int
        let app: App
        let window: Window
    }

    public let schemaVersion: Int
    public let protocolVersion: Int
    public let app: App
    public let window: Window
    public let runtime: Runtime

    public init(
        schemaVersion: Int,
        protocolVersion: Int,
        app: App,
        window: Window,
        runtime: Runtime = .production
    ) {
        self.schemaVersion = schemaVersion
        self.protocolVersion = protocolVersion
        self.app = app
        self.window = window
        self.runtime = runtime
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
        guard let appObject = root["app"] as? [String: Any], let windowObject = root["window"] as? [String: Any] else {
            throw HostConfigurationError.invalidShape
        }
        try requireExactKeys(appObject, expected: ["name", "identifier", "quitOnLastWindowClosed"], at: "app")
        try requireExactKeys(windowObject, expected: ["width", "height", "minWidth", "minHeight"], at: "window")

        let configuration: HostConfiguration
        do {
            switch schemaVersion {
            case 1:
                try requireExactKeys(
                    root,
                    expected: ["schemaVersion", "protocolVersion", "app", "window"],
                    at: "root"
                )
                let legacy = try JSONDecoder().decode(LegacyConfiguration.self, from: data)
                configuration = HostConfiguration(
                    schemaVersion: legacy.schemaVersion,
                    protocolVersion: legacy.protocolVersion,
                    app: legacy.app,
                    window: legacy.window,
                    runtime: .production
                )
            case 2:
                try requireExactKeys(
                    root,
                    expected: ["schemaVersion", "protocolVersion", "app", "window", "runtime"],
                    at: "root"
                )
                guard let runtimeObject = root["runtime"] as? [String: Any],
                      let mode = runtimeObject["mode"] as? String
                else { throw HostConfigurationError.invalidShape }
                switch mode {
                case Runtime.Mode.production.rawValue:
                    try requireExactKeys(runtimeObject, expected: ["mode"], at: "runtime")
                case Runtime.Mode.development.rawValue:
                    try requireExactKeys(runtimeObject, expected: ["mode", "executable", "arguments"], at: "runtime")
                default:
                    throw HostConfigurationError.invalidRuntime
                }
                configuration = try JSONDecoder().decode(HostConfiguration.self, from: data)
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

    private func validate() throws {
        guard schemaVersion == 1 || schemaVersion == 2 else {
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
        guard dimensions.allSatisfy({ $0.isFinite && $0 > 0 }) else {
            throw HostConfigurationError.invalidWindowDimensions
        }
        guard window.width >= window.minWidth, window.height >= window.minHeight else {
            throw HostConfigurationError.invalidWindowDimensions
        }
        switch runtime.mode {
        case .production:
            guard runtime.executable == nil, runtime.arguments == nil else {
                throw HostConfigurationError.invalidRuntime
            }
        case .development:
            guard schemaVersion == 2,
                  let executable = runtime.executable,
                  NSString(string: executable).isAbsolutePath,
                  !executable.contains("\0"),
                  let arguments = runtime.arguments,
                  !arguments.isEmpty,
                  arguments.count <= 128,
                  arguments.allSatisfy({ !$0.isEmpty && !$0.contains("\0") })
            else { throw HostConfigurationError.invalidRuntime }
        }
    }

    private static func requireExactKeys(
        _ object: [String: Any],
        expected: Set<String>,
        at path: String
    ) throws {
        let actual = Set(object.keys)
        guard actual == expected else {
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
    case invalidRuntime

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
        case .invalidRuntime: "Runtime launch configuration is invalid"
        }
    }
}
