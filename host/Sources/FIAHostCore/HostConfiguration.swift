import Foundation

public let FIAHostSchemaVersion = 6
public let FIAStdioProtocolVersion = 1
public let FIAMaximumStdioFrameBytes = 1024 * 1024
public let FIAMaximumPendingRequests = 128

public struct HostConfiguration: Codable, Equatable, Sendable {
    public struct App: Codable, Equatable, Sendable {
        public let name: String
        public let identifier: String

        public init(name: String, identifier: String) {
            self.name = name
            self.identifier = identifier
        }
    }

    public struct StatusItem: Codable, Equatable, Sendable {
        public let symbol: String
        public let tooltip: String

        public init(symbol: String, tooltip: String) {
            self.symbol = symbol
            self.tooltip = tooltip
        }
    }

    public struct Backend: Codable, Equatable, Sendable {
        public let executable: String
        public let arguments: [String]
        public let sha256: String

        public init(executable: String, arguments: [String] = [], sha256: String) {
            self.executable = executable
            self.arguments = arguments
            self.sha256 = sha256
        }
    }

    public let schemaVersion: Int
    public let stdioProtocolVersion: Int
    public let development: Bool
    public let app: App
    public let statusItem: StatusItem
    public let backend: Backend
    public let hostCapabilities: [String]

    public init(
        schemaVersion: Int = FIAHostSchemaVersion,
        stdioProtocolVersion: Int = FIAStdioProtocolVersion,
        development: Bool = false,
        app: App,
        statusItem: StatusItem,
        backend: Backend,
        hostCapabilities: [String] = HostCapabilityManifest.values
    ) {
        self.schemaVersion = schemaVersion
        self.stdioProtocolVersion = stdioProtocolVersion
        self.development = development
        self.app = app
        self.statusItem = statusItem
        self.backend = backend
        self.hostCapabilities = hostCapabilities
    }

    public static func load(from url: URL, maximumBytes: Int = 64 * 1024) throws -> HostConfiguration {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        if let size = values.fileSize, size > maximumBytes { throw HostConfigurationError.fileTooLarge }
        return try decode(Data(contentsOf: url, options: [.mappedIfSafe]), maximumBytes: maximumBytes)
    }

    public static func decode(_ data: Data, maximumBytes: Int = 64 * 1024) throws -> HostConfiguration {
        guard data.count <= maximumBytes else { throw HostConfigurationError.fileTooLarge }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw HostConfigurationError.invalidJSON
        }
        guard let root = object as? [String: Any], let schema = root["schemaVersion"] as? Int else {
            throw HostConfigurationError.invalidShape
        }
        guard schema == FIAHostSchemaVersion else { throw HostConfigurationError.unsupportedSchema(schema) }
        try requireExactKeys(
            root,
            expected: ["schemaVersion", "stdioProtocolVersion", "development", "app", "statusItem", "backend", "hostCapabilities"],
            at: "root"
        )
        try requireExactKeys(root["app"], expected: ["name", "identifier"], at: "app")
        try requireExactKeys(root["statusItem"], expected: ["symbol", "tooltip"], at: "statusItem")
        try requireExactKeys(root["backend"], expected: ["executable", "arguments", "sha256"], at: "backend")
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
        guard stdioProtocolVersion == FIAStdioProtocolVersion else {
            throw HostConfigurationError.unsupportedStdioProtocol(stdioProtocolVersion)
        }
        guard !app.name.isEmpty, !app.name.contains("\0"), !app.identifier.isEmpty, !app.identifier.contains("\0") else {
            throw HostConfigurationError.invalidApp
        }
        guard !statusItem.symbol.isEmpty,
              statusItem.symbol.count <= 128,
              statusItem.symbol == statusItem.symbol.trimmingCharacters(in: .whitespacesAndNewlines),
              !statusItem.tooltip.isEmpty,
              statusItem.tooltip.count <= 512
        else { throw HostConfigurationError.invalidStatusItem }
        let validExecutable = development
            ? backend.executable.hasPrefix("/")
            : backend.executable == "Helpers/FIABackend"
        guard validExecutable,
              !backend.executable.contains("\0"),
              backend.arguments.allSatisfy({ !$0.contains("\0") }),
              backend.sha256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
        else { throw HostConfigurationError.invalidBackend }
        guard hostCapabilities == HostCapabilityManifest.values else {
            throw HostConfigurationError.invalidHostCapabilities
        }
    }

    private static func requireExactKeys(_ value: Any?, expected: Set<String>, at path: String) throws {
        guard let object = value as? [String: Any], Set(object.keys) == expected else {
            throw HostConfigurationError.unknownFields(path)
        }
    }
}

public enum HostCapabilityManifest {
    public static let values = ["application", "statusItem", "webviews", "system"]
}

public enum HostConfigurationError: Error, Equatable, LocalizedError, Sendable {
    case fileTooLarge
    case invalidJSON
    case invalidShape
    case unsupportedSchema(Int)
    case unsupportedStdioProtocol(Int)
    case unknownFields(String)
    case invalidApp
    case invalidStatusItem
    case invalidBackend
    case invalidHostCapabilities

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge: "Host configuration exceeds the size limit"
        case .invalidJSON: "Host configuration is not valid JSON"
        case .invalidShape: "Host configuration has an invalid shape"
        case let .unsupportedSchema(version): "Unsupported Host configuration schema \(version)"
        case let .unsupportedStdioProtocol(version): "Unsupported stdio protocol \(version)"
        case let .unknownFields(path): "Host configuration contains unknown or missing fields at \(path)"
        case .invalidApp: "Host app configuration is invalid"
        case .invalidStatusItem: "Host status item configuration is invalid"
        case .invalidBackend: "Host backend configuration is invalid"
        case .invalidHostCapabilities: "Host capabilities are invalid"
        }
    }
}
