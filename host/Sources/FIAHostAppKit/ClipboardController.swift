import AppKit
import FIAHostCore
import Foundation

@MainActor
protocol ClipboardClient {
    func readText() -> String?
    func writeText(_ text: String) -> Bool
    func writePNG(_ data: Data) -> Bool
    func clear()
}

@MainActor
struct SystemClipboardClient: ClipboardClient {
    private let pasteboard = NSPasteboard.general

    func readText() -> String? { pasteboard.string(forType: .string) }

    func writeText(_ text: String) -> Bool {
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string)
    }

    func writePNG(_ data: Data) -> Bool {
        guard NSBitmapImageRep(data: data) != nil else { return false }
        pasteboard.clearContents()
        return pasteboard.setData(data, forType: .png)
    }

    func clear() { pasteboard.clearContents() }
}

@MainActor
final class ClipboardController {
    private static let pngSignature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    private let client: ClipboardClient

    init(client: ClipboardClient = SystemClipboardClient()) {
        self.client = client
    }

    func execute(method: String, params: [String: Any]) throws -> Any? {
        switch method {
        case "clipboard.readText":
            try requireKeys(params, allowed: [])
            return client.readText() ?? NSNull()
        case "clipboard.writeText":
            try requireKeys(params, allowed: ["text"])
            guard let text = params["text"] as? String else {
                throw invalid("text must be a string")
            }
            guard client.writeText(text) else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "macOS could not write text to the clipboard")
            }
            return nil
        case "clipboard.writeImage":
            try requireKeys(params, allowed: ["path"])
            let url = try pngURL(params["path"])
            let data: Data
            do {
                data = try Data(contentsOf: url, options: [.mappedIfSafe])
            } catch {
                throw HostRequestExecutionError(
                    code: .nativeFailure,
                    message: "could not read PNG image: \(error.localizedDescription)"
                )
            }
            guard data.starts(with: Self.pngSignature) else {
                throw invalid("path must name a PNG image")
            }
            guard client.writePNG(data) else {
                throw invalid("path must name a decodable PNG image")
            }
            return nil
        case "clipboard.clear":
            try requireKeys(params, allowed: [])
            client.clear()
            return nil
        default:
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown clipboard method: \(method)")
        }
    }

    private func requireKeys(_ params: [String: Any], allowed: Set<String>) throws {
        guard Set(params.keys).isSubset(of: allowed) else {
            throw invalid("clipboard parameters contain unknown fields")
        }
    }

    private func pngURL(_ value: Any?) throws -> URL {
        guard let path = value as? String, path.hasPrefix("/"), !path.contains("\0") else {
            throw invalid("path must be an absolute POSIX path")
        }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.pathExtension.lowercased() == "png" else {
            throw invalid("path must have a .png extension")
        }
        let resolved = url.resolvingSymlinksInPath()
        let values: URLResourceValues
        do {
            values = try resolved.resourceValues(forKeys: [.isRegularFileKey])
        } catch {
            throw HostRequestExecutionError(code: .notFound, message: "PNG image does not exist: \(url.path)")
        }
        guard values.isRegularFile == true else {
            throw invalid("path must name a regular PNG file")
        }
        return resolved
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
