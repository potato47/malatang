import AppKit
import FIAHostCore
import Foundation

@MainActor
protocol SystemWorkspaceClient {
    func open(_ url: URL) -> Bool
    func reveal(_ urls: [URL])
    func trash(_ url: URL) async throws -> URL
}

@MainActor
struct NativeSystemWorkspaceClient: SystemWorkspaceClient {
    private let workspace = NSWorkspace.shared

    func open(_ url: URL) -> Bool { workspace.open(url) }

    func reveal(_ urls: [URL]) { workspace.activateFileViewerSelecting(urls) }

    func trash(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            workspace.recycle([url]) { destinations, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let destination = destinations[url] {
                    continuation.resume(returning: destination)
                } else {
                    continuation.resume(
                        throwing: CocoaError(.fileNoSuchFile, userInfo: [
                            NSLocalizedDescriptionKey: "macOS did not return the trashed file location",
                        ])
                    )
                }
            }
        }
    }
}

@MainActor
final class SystemController {
    private let client: SystemWorkspaceClient
    private let fileManager: FileManager

    init(
        client: SystemWorkspaceClient = NativeSystemWorkspaceClient(),
        fileManager: FileManager = .default
    ) {
        self.client = client
        self.fileManager = fileManager
    }

    func execute(method: String, params: [String: Any]) async throws -> Any? {
        switch method {
        case "system.openURL":
            try requireKeys(params, allowed: ["url"])
            guard let raw = params["url"] as? String, let url = URL(string: raw),
                  url.scheme == "http" || url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil else {
                throw invalid("URL must be HTTP(S)")
            }
            guard client.open(url) else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "macOS could not open the URL")
            }
            return nil
        case "system.openPath":
            try requireKeys(params, allowed: ["path"])
            let url = try existingPath(params["path"], allowingRoot: true)
            guard client.open(url) else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "macOS could not open the path")
            }
            return nil
        case "system.revealPath":
            try requireKeys(params, allowed: ["path"])
            client.reveal([try existingPath(params["path"], allowingRoot: true)])
            return nil
        case "system.trashPath":
            try requireKeys(params, allowed: ["path"])
            let destination: URL
            do {
                destination = try await client.trash(try existingPath(params["path"], allowingRoot: false))
            } catch let error as HostRequestExecutionError {
                throw error
            } catch {
                throw HostRequestExecutionError(
                    code: .nativeFailure,
                    message: "macOS could not move the path to Trash: \(error.localizedDescription)"
                )
            }
            return destination.standardizedFileURL.path
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown system method: \(method)")
        }
    }

    private func existingPath(_ value: Any?, allowingRoot: Bool) throws -> URL {
        guard let path = value as? String, path.hasPrefix("/"), !path.contains("\0") else {
            throw invalid("path must be an absolute POSIX path")
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard allowingRoot || url.path != "/" else { throw invalid("the filesystem root cannot be trashed") }
        guard fileManager.fileExists(atPath: url.path) else {
            throw HostRequestExecutionError(code: .notFound, message: "path does not exist: \(url.path)")
        }
        return url
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("system parameters contain unknown fields")
        }
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
