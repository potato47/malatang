import AppKit
import FIAHostCore
import Foundation
import UniformTypeIdentifiers

struct OpenFilePanelConfiguration: Equatable {
    let title: String?
    let directory: URL?
    let showHiddenFiles: Bool
    let multiple: Bool
    let allowedContentTypes: [UTType]
}

struct OpenDirectoryPanelConfiguration: Equatable {
    let title: String?
    let directory: URL?
    let showHiddenFiles: Bool
    let multiple: Bool
}

struct SaveFilePanelConfiguration: Equatable {
    let title: String?
    let directory: URL?
    let showHiddenFiles: Bool
    let allowedContentTypes: [UTType]
    let name: String?
    let canCreateDirectories: Bool
}

@MainActor
protocol FilePanelClient {
    func openFiles(_ configuration: OpenFilePanelConfiguration) async throws -> [URL]?
    func openDirectories(_ configuration: OpenDirectoryPanelConfiguration) async throws -> [URL]?
    func saveFile(_ configuration: SaveFilePanelConfiguration) async throws -> URL?
}

@MainActor
final class SystemFilePanelClient: FilePanelClient {
    func openFiles(_ configuration: OpenFilePanelConfiguration) async throws -> [URL]? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = configuration.multiple
        applyCommon(configuration.title, configuration.directory, configuration.showHiddenFiles, to: panel)
        panel.allowedContentTypes = configuration.allowedContentTypes
        let response = try await run(panel)
        return response == .OK ? panel.urls : nil
    }

    func openDirectories(_ configuration: OpenDirectoryPanelConfiguration) async throws -> [URL]? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = configuration.multiple
        applyCommon(configuration.title, configuration.directory, configuration.showHiddenFiles, to: panel)
        let response = try await run(panel)
        return response == .OK ? panel.urls : nil
    }

    func saveFile(_ configuration: SaveFilePanelConfiguration) async throws -> URL? {
        let panel = NSSavePanel()
        applyCommon(configuration.title, configuration.directory, configuration.showHiddenFiles, to: panel)
        panel.allowedContentTypes = configuration.allowedContentTypes
        panel.canCreateDirectories = configuration.canCreateDirectories
        if let name = configuration.name { panel.nameFieldStringValue = name }
        let response = try await run(panel)
        return response == .OK ? panel.url : nil
    }

    private func applyCommon(_ title: String?, _ directory: URL?, _ hidden: Bool, to panel: NSSavePanel) {
        if let title { panel.title = title }
        panel.directoryURL = directory
        panel.showsHiddenFiles = hidden
    }

    private func run(_ panel: NSSavePanel) async throws -> NSApplication.ModalResponse {
        try Task.checkCancellation()
        let response = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                panel.begin { continuation.resume(returning: $0) }
            }
        } onCancel: {
            Task { @MainActor in panel.cancel(nil) }
        }
        try Task.checkCancellation()
        return response
    }
}

@MainActor
final class DialogController {
    private let client: FilePanelClient

    init(client: FilePanelClient = SystemFilePanelClient()) {
        self.client = client
    }

    func execute(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "dialogs.openFile":
            try requireKeys(
                params,
                allowed: ["title", "directory", "showHiddenFiles", "allowedExtensions", "multiple"]
            )
            let configuration = OpenFilePanelConfiguration(
                title: try optionalString(params["title"], field: "title", maximum: 512),
                directory: try directory(params["directory"]),
                showHiddenFiles: try optionalBool(params["showHiddenFiles"], field: "showHiddenFiles") ?? false,
                multiple: try optionalBool(params["multiple"], field: "multiple") ?? false,
                allowedContentTypes: try contentTypes(params["allowedExtensions"])
            )
            return try await client.openFiles(configuration)?.map(Self.path)
        case "dialogs.openDirectory":
            try requireKeys(params, allowed: ["title", "directory", "showHiddenFiles", "multiple"])
            let configuration = OpenDirectoryPanelConfiguration(
                title: try optionalString(params["title"], field: "title", maximum: 512),
                directory: try directory(params["directory"]),
                showHiddenFiles: try optionalBool(params["showHiddenFiles"], field: "showHiddenFiles") ?? false,
                multiple: try optionalBool(params["multiple"], field: "multiple") ?? false
            )
            return try await client.openDirectories(configuration)?.map(Self.path)
        case "dialogs.saveFile":
            try requireKeys(
                params,
                allowed: [
                    "title", "directory", "showHiddenFiles", "allowedExtensions", "name",
                    "canCreateDirectories",
                ]
            )
            let configuration = SaveFilePanelConfiguration(
                title: try optionalString(params["title"], field: "title", maximum: 512),
                directory: try directory(params["directory"]),
                showHiddenFiles: try optionalBool(params["showHiddenFiles"], field: "showHiddenFiles") ?? false,
                allowedContentTypes: try contentTypes(params["allowedExtensions"]),
                name: try fileName(params["name"]),
                canCreateDirectories: try optionalBool(
                    params["canCreateDirectories"],
                    field: "canCreateDirectories"
                ) ?? true
            )
            return try await client.saveFile(configuration).map(Self.path)
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown dialog method: \(method)")
        }
    }

    private static func path(_ url: URL) -> String { url.standardizedFileURL.path }

    private func directory(_ value: Any?) throws -> URL? {
        guard let value else { return nil }
        guard let path = value as? String, path.hasPrefix("/"), !path.contains("\0") else {
            throw invalid("directory must be an absolute POSIX path")
        }
        let url = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw invalid("directory must name an existing directory")
        }
        return url
    }

    private func contentTypes(_ value: Any?) throws -> [UTType] {
        guard let value else { return [] }
        guard let extensions = value as? [String], !extensions.isEmpty, extensions.count <= 32 else {
            throw invalid("allowedExtensions must be a non-empty array of at most 32 extensions")
        }
        return try extensions.map { value in
            guard value.range(of: #"^[A-Za-z0-9][A-Za-z0-9+._-]{0,31}$"#, options: .regularExpression) != nil,
                  let type = UTType(filenameExtension: value)
            else { throw invalid("invalid filename extension: \(value)") }
            return type
        }
    }

    private func fileName(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        guard let value = value as? String, !value.isEmpty, value.count <= 255,
              !value.contains("/"), !value.contains(":"), !value.contains("\0")
        else { throw invalid("name must be a valid filename of at most 255 characters") }
        return value
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("dialog parameters contain unknown fields")
        }
    }

    private func optionalString(_ value: Any?, field: String, maximum: Int) throws -> String? {
        guard let value else { return nil }
        guard let value = value as? String, !value.isEmpty, !value.contains("\0"), value.count <= maximum else {
            throw invalid("\(field) must be a non-empty string of at most \(maximum) characters")
        }
        return value
    }

    private func optionalBool(_ value: Any?, field: String) throws -> Bool? {
        guard let value else { return nil }
        guard let value = value as? Bool else { throw invalid("\(field) must be a boolean") }
        return value
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
