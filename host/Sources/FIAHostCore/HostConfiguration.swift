import Foundation

public let FIAHostSchemaVersion = 5
public let FIAMCPBridgeVersion = 1
public let FIAMCPProtocolVersion = "2026-07-28"

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

    public struct UI: Codable, Equatable, Sendable {
        public enum Mode: String, Codable, Equatable, Sendable {
            case bundled
            case development
        }

        public let mode: Mode
        public let entry: String?
        public let url: String?

        public init(mode: Mode, entry: String? = nil, url: String? = nil) {
            self.mode = mode
            self.entry = entry
            self.url = url
        }

        public var isDevelopment: Bool { mode == .development }
    }

    public struct MCPServer: Codable, Equatable, Sendable {
        public let id: String
        public let executable: String
        public let arguments: [String]
        public let sha256: String

        public init(id: String, executable: String, arguments: [String] = [], sha256: String) {
            self.id = id
            self.executable = executable
            self.arguments = arguments
            self.sha256 = sha256
        }
    }

    public let schemaVersion: Int
    public let bridgeVersion: Int
    public let mcpProtocolVersion: String
    public let app: App
    public let window: Window
    public let statusBar: StatusBar
    public let ui: UI
    public let mcpServers: [MCPServer]
    public let nativeCapabilities: [String]

    public init(
        schemaVersion: Int = FIAHostSchemaVersion,
        bridgeVersion: Int = FIAMCPBridgeVersion,
        mcpProtocolVersion: String = FIAMCPProtocolVersion,
        app: App,
        window: Window,
        statusBar: StatusBar,
        ui: UI,
        mcpServers: [MCPServer] = [],
        nativeCapabilities: [String] = NativeMCPManifest.capabilities
    ) {
        self.schemaVersion = schemaVersion
        self.bridgeVersion = bridgeVersion
        self.mcpProtocolVersion = mcpProtocolVersion
        self.app = app
        self.window = window
        self.statusBar = statusBar
        self.ui = ui
        self.mcpServers = mcpServers
        self.nativeCapabilities = nativeCapabilities
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
        guard let root = object as? [String: Any],
              let schemaVersion = root["schemaVersion"] as? Int
        else { throw HostConfigurationError.invalidShape }
        guard schemaVersion == FIAHostSchemaVersion else {
            throw HostConfigurationError.unsupportedSchema(schemaVersion)
        }
        do {
            try requireExactKeys(
                root,
                expected: [
                    "schemaVersion", "bridgeVersion", "mcpProtocolVersion", "app", "window",
                    "statusBar", "ui", "mcpServers", "nativeCapabilities",
                ],
                at: "root"
            )
            try requireExactKeys(root["app"], expected: ["name", "identifier", "mode"], at: "app")
            try requireExactKeys(
                root["window"],
                expected: [
                    "width", "height", "minWidth", "minHeight", "closeBehavior", "restoreState",
                    "alwaysOnTop", "visibleOnAllSpaces", "visibleOverFullScreen",
                ],
                at: "window"
            )
            try requireExactKeys(root["statusBar"], expected: ["symbol", "tooltip"], at: "statusBar")
            try requireExactKeys(root["ui"], expected: ["mode", "entry", "url"], at: "ui")
            guard let serverValues = root["mcpServers"] as? [Any] else {
                throw HostConfigurationError.invalidShape
            }
            for (index, value) in serverValues.enumerated() {
                try requireExactKeys(
                    value,
                    expected: ["id", "executable", "arguments", "sha256"],
                    at: "mcpServers.\(index)"
                )
            }
            let configuration = try JSONDecoder().decode(HostConfiguration.self, from: data)
            try configuration.validate()
            return configuration
        } catch let error as HostConfigurationError {
            throw error
        } catch {
            throw HostConfigurationError.invalidShape
        }
    }

    private func validate() throws {
        guard bridgeVersion == FIAMCPBridgeVersion else {
            throw HostConfigurationError.unsupportedBridge(bridgeVersion)
        }
        guard mcpProtocolVersion == FIAMCPProtocolVersion else {
            throw HostConfigurationError.unsupportedMCPProtocol(mcpProtocolVersion)
        }
        guard !app.name.isEmpty, !app.identifier.isEmpty,
              window.width >= window.minWidth, window.height >= window.minHeight,
              window.minWidth > 0, window.minHeight > 0,
              !statusBar.symbol.isEmpty, !statusBar.tooltip.isEmpty
        else { throw HostConfigurationError.invalidShape }

        switch ui.mode {
        case .bundled:
            guard let entry = ui.entry,
                  ui.url == nil,
                  entry.hasPrefix("UI/"),
                  !entry.contains(".."),
                  !entry.contains("\0")
            else { throw HostConfigurationError.invalidUI }
        case .development:
            guard ui.entry == nil,
                  let value = ui.url,
                  let url = URL(string: value),
                  url.scheme == "http",
                  url.host == "127.0.0.1",
                  url.port != nil,
                  url.user == nil,
                  url.password == nil
            else { throw HostConfigurationError.invalidUI }
        }

        guard mcpServers.count <= 64 else { throw HostConfigurationError.invalidMCPServer }
        var ids = Set<String>()
        for server in mcpServers {
            let validID = server.id == "app"
                || (server.id.range(of: #"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$"#, options: .regularExpression) != nil
                    && !server.id.contains("..")
                    && !server.id.hasPrefix("fia."))
            let validExecutable = ui.isDevelopment
                ? server.executable.hasPrefix("/")
                : server.executable == "Helpers/MCPServers/\(server.id)"
            guard validID,
                  server.id != "fia.native",
                  ids.insert(server.id).inserted,
                  validExecutable,
                  !server.executable.contains("\0"),
                  server.sha256.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
                  server.arguments.allSatisfy({ !$0.contains("\0") })
            else { throw HostConfigurationError.invalidMCPServer }
        }
        guard Set(nativeCapabilities) == Set(NativeMCPManifest.capabilities) else {
            throw HostConfigurationError.invalidNativeCapabilities
        }
    }

    private static func requireExactKeys(_ value: Any?, expected: Set<String>, at path: String) throws {
        guard let object = value as? [String: Any], Set(object.keys) == expected else {
            throw HostConfigurationError.unknownFields(path)
        }
    }
}

public enum NativeMCPManifest {
    public static let capabilities = ["tools", "resources", "subscriptions"]
}

public enum HostConfigurationError: Error, Equatable, LocalizedError, Sendable {
    case fileTooLarge
    case invalidJSON
    case invalidShape
    case unsupportedSchema(Int)
    case unsupportedBridge(Int)
    case unsupportedMCPProtocol(String)
    case unknownFields(String)
    case invalidUI
    case invalidMCPServer
    case invalidNativeCapabilities

    public var errorDescription: String? {
        switch self {
        case .fileTooLarge: "Host configuration exceeds the size limit"
        case .invalidJSON: "Host configuration is not valid JSON"
        case .invalidShape: "Host configuration has an invalid shape"
        case let .unsupportedSchema(version): "Unsupported Host configuration schema \(version)"
        case let .unsupportedBridge(version): "Unsupported MCP bridge version \(version)"
        case let .unsupportedMCPProtocol(version): "Unsupported MCP protocol \(version)"
        case let .unknownFields(path): "Host configuration contains unknown or missing fields at \(path)"
        case .invalidUI: "Host UI configuration is invalid"
        case .invalidMCPServer: "Host MCP server configuration is invalid"
        case .invalidNativeCapabilities: "Host native MCP capabilities are invalid"
        }
    }
}
