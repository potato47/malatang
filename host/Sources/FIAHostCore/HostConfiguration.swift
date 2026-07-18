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

    public let schemaVersion: Int
    public let protocolVersion: Int
    public let app: App
    public let window: Window

    public init(schemaVersion: Int, protocolVersion: Int, app: App, window: Window) {
        self.schemaVersion = schemaVersion
        self.protocolVersion = protocolVersion
        self.app = app
        self.window = window
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
        guard let root = object as? [String: Any] else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(root, expected: ["schemaVersion", "protocolVersion", "app", "window"], at: "root")
        guard let app = root["app"] as? [String: Any] else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(app, expected: ["name", "identifier", "quitOnLastWindowClosed"], at: "app")
        guard let window = root["window"] as? [String: Any] else { throw HostConfigurationError.invalidShape }
        try requireExactKeys(window, expected: ["width", "height", "minWidth", "minHeight"], at: "window")

        let configuration: HostConfiguration
        do {
            configuration = try JSONDecoder().decode(HostConfiguration.self, from: data)
        } catch {
            throw HostConfigurationError.invalidShape
        }
        try configuration.validate()
        return configuration
    }

    private func validate() throws {
        guard schemaVersion == 1 else { throw HostConfigurationError.unsupportedSchema(schemaVersion) }
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
        }
    }
}

