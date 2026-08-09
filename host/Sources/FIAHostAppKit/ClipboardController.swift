import AppKit
import FIAHostCore
import Foundation

@MainActor
protocol ClipboardClient {
    func readText() -> String?
    func writeText(_ text: String) -> Bool
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

    func clear() { pasteboard.clearContents() }
}

@MainActor
final class ClipboardController {
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

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
