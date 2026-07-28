import FIAHostCore
import Foundation

struct NativeCommandExecutionError: Error, LocalizedError {
    let code: NativeMCPErrorCode
    let message: String

    var errorDescription: String? { message }
}

@MainActor
final class NativeMCPServer {
    static let serverID = "fia.native"
    static let stateResourceURI = "fia://native/state"

    private let execute: (NativeMCPCommand) throws -> DesktopState
    private var subscriptions: [String: Set<String>] = [:]

    init(execute: @escaping (NativeMCPCommand) throws -> DesktopState) {
        self.execute = execute
    }

    func handle(_ message: [String: Any]) -> [String: Any]? {
        guard let method = message["method"] as? String else { return nil }
        guard validModernEnvelope(message) else {
            guard let id = message["id"] else { return nil }
            return failure(id: id, code: -32602, message: "MCP 2026-07-28 _meta envelope is required")
        }
        if method == "notifications/cancelled" {
            if let params = message["params"] as? [String: Any],
               let requestID = params["requestId"] as? String {
                subscriptions.removeValue(forKey: requestID)
            }
            return nil
        }
        guard let id = message["id"] else { return nil }
        do {
            let result: [String: Any]
            switch method {
            case "server/discover":
                result = complete([
                    "supportedVersions": [FIAMCPProtocolVersion],
                    "capabilities": [
                        "tools": ["listChanged": false],
                        "resources": ["subscribe": true, "listChanged": false],
                    ],
                    "instructions": "FIA native desktop tools and state resources",
                ])
            case "tools/list":
                result = cacheable(["tools": Self.tools])
            case "tools/call":
                result = try callTool(message)
            case "resources/list":
                result = cacheable([
                    "resources": [[
                        "uri": Self.stateResourceURI,
                        "name": "FIA native desktop state",
                        "description": "Current window, Dock, and status bar state",
                        "mimeType": "application/json",
                    ]],
                ])
            case "resources/read":
                result = try readResource(message)
            case "subscriptions/listen":
                return try acknowledgeSubscription(id: id, message: message)
            default:
                return failure(id: id, code: -32601, message: "Method not found")
            }
            return success(id: id, result: result)
        } catch let error as NativeMCPCommandError {
            return failure(
                id: id,
                code: -32602,
                message: error.message,
                data: ["code": error.code.rawValue]
            )
        } catch let error as NativeCommandExecutionError {
            return failure(id: id, code: -32603, message: error.message, data: ["code": error.code.rawValue])
        } catch let error as DesktopStateError {
            return failure(
                id: id,
                code: -32603,
                message: error.localizedDescription,
                data: ["code": NativeMCPErrorCode.unsafeState.rawValue]
            )
        } catch {
            return failure(id: id, code: -32603, message: "Native MCP operation failed")
        }
    }

    func resourceUpdatedNotifications() -> [[String: Any]] {
        subscriptions.keys.sorted().compactMap { subscriptionID in
            guard subscriptions[subscriptionID]?.contains(Self.stateResourceURI) == true else { return nil }
            return [
                "jsonrpc": "2.0",
                "method": "notifications/resources/updated",
                "params": [
                    "_meta": ["io.modelcontextprotocol/subscriptionId": subscriptionID],
                    "uri": Self.stateResourceURI,
                ],
            ]
        }
    }

    func resetSubscriptions() {
        subscriptions.removeAll()
    }

    private func callTool(_ message: [String: Any]) throws -> [String: Any] {
        guard let params = message["params"] as? [String: Any],
              let name = params["name"] as? String
        else {
            throw NativeMCPCommandError(code: .invalidRequest, message: "tools/call requires a tool name")
        }
        let arguments = params["arguments"] as? [String: Any] ?? [:]
        let command = try NativeMCPCommandParser.parse(command: name, arguments: arguments)
        let state = try execute(command)
        let value: Any = name == "app.quit" ? [:] : try Self.jsonObject(state)
        let textData = try JSONSerialization.data(withJSONObject: value)
        return complete([
            "content": [["type": "text", "text": String(decoding: textData, as: UTF8.self)]],
            "structuredContent": value,
            "isError": false,
        ])
    }

    private func readResource(_ message: [String: Any]) throws -> [String: Any] {
        guard let params = message["params"] as? [String: Any],
              params["uri"] as? String == Self.stateResourceURI
        else {
            throw NativeMCPCommandError(code: .invalidArgument, message: "Unknown native resource URI")
        }
        let state = try execute(.getState)
        let data = try JSONEncoder().encode(state)
        return cacheable([
            "contents": [[
                "uri": Self.stateResourceURI,
                "mimeType": "application/json",
                "text": String(decoding: data, as: UTF8.self),
            ]],
        ])
    }

    private func acknowledgeSubscription(id: Any, message: [String: Any]) throws -> [String: Any] {
        guard let subscriptionID = id as? String,
              let params = message["params"] as? [String: Any],
              let requested = params["notifications"] as? [String: Any],
              Set(requested.keys).isSubset(of: Set([
                "toolsListChanged",
                "promptsListChanged",
                "resourcesListChanged",
                "resourceSubscriptions",
              ]))
        else {
            throw NativeMCPCommandError(
                code: .invalidArgument,
                message: "subscriptions/listen requires a valid notification filter"
            )
        }
        let requestedResources = requested["resourceSubscriptions"] as? [String] ?? []
        if requested["resourceSubscriptions"] != nil
            && requested["resourceSubscriptions"] as? [String] == nil {
            throw NativeMCPCommandError(
                code: .invalidArgument,
                message: "resourceSubscriptions must be an array of resource URIs"
            )
        }
        for key in ["toolsListChanged", "promptsListChanged", "resourcesListChanged"]
        where requested[key] != nil && requested[key] as? Bool == nil {
            throw NativeMCPCommandError(
                code: .invalidArgument,
                message: "\(key) must be a boolean"
            )
        }
        guard subscriptions[subscriptionID] != nil || subscriptions.count < 1024 else {
            throw NativeMCPCommandError(
                code: .nativeFailure,
                message: "Native MCP subscription capacity was exceeded"
            )
        }
        let honoredResources = requestedResources.filter { $0 == Self.stateResourceURI }
        subscriptions[subscriptionID] = Set(honoredResources)
        let honored: [String: Any] = honoredResources.isEmpty
            ? [:]
            : ["resourceSubscriptions": honoredResources]
        return [
            "jsonrpc": "2.0",
            "method": "notifications/subscriptions/acknowledged",
            "params": [
                "_meta": ["io.modelcontextprotocol/subscriptionId": subscriptionID],
                "notifications": honored,
            ],
        ]
    }

    private func validModernEnvelope(_ message: [String: Any]) -> Bool {
        guard let params = message["params"] as? [String: Any],
              let meta = params["_meta"] as? [String: Any],
              meta["io.modelcontextprotocol/protocolVersion"] as? String == FIAMCPProtocolVersion,
              meta["io.modelcontextprotocol/clientCapabilities"] is [String: Any]
        else { return false }
        return true
    }

    private func complete(_ value: [String: Any]) -> [String: Any] {
        stamp(value.merging(["resultType": "complete"]) { current, _ in current })
    }

    private func cacheable(_ value: [String: Any]) -> [String: Any] {
        stamp(value.merging([
            "resultType": "complete",
            "ttlMs": 0,
            "cacheScope": "private",
        ]) { current, _ in current })
    }

    private func stamp(_ value: [String: Any]) -> [String: Any] {
        value.merging([
            "_meta": [
                "io.modelcontextprotocol/serverInfo": [
                    "name": Self.serverID,
                    "version": "0.5.0",
                ],
            ],
        ]) { current, _ in current }
    }

    private func success(id: Any, result: [String: Any]) -> [String: Any] {
        ["jsonrpc": "2.0", "id": id, "result": result]
    }

    private func failure(id: Any, code: Int, message: String, data: Any? = nil) -> [String: Any] {
        var error: [String: Any] = ["code": code, "message": message]
        if let data { error["data"] = data }
        return ["jsonrpc": "2.0", "id": id, "error": error]
    }

    private static func jsonObject<Value: Encodable>(_ value: Value) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    private static let emptyInputSchema: [String: Any] = [
        "type": "object",
        "properties": [:],
        "additionalProperties": false,
    ]
    private static let booleanInputSchema: [String: Any] = [
        "type": "object",
        "properties": ["enabled": ["type": "boolean"]],
        "required": ["enabled"],
        "additionalProperties": false,
    ]
    private static let tools: [[String: Any]] = [
        tool("native.getState", "Read the current desktop state", emptyInputSchema),
        tool("app.quit", "Quit the application", emptyInputSchema),
        tool("app.showDock", "Show the Dock icon", emptyInputSchema),
        tool("app.hideDock", "Hide the Dock icon", emptyInputSchema),
        tool("window.show", "Show the main window", emptyInputSchema),
        tool("window.hide", "Hide the main window", emptyInputSchema),
        tool("window.focus", "Focus the main window", emptyInputSchema),
        tool("window.setAlwaysOnTop", "Set floating window level", booleanInputSchema),
        tool("window.setVisibleOnAllSpaces", "Set all-Spaces visibility", booleanInputSchema),
        tool("window.setVisibleOverFullScreen", "Set full-screen overlay visibility", booleanInputSchema),
        tool(
            "statusBar.setVisible",
            "Set status item visibility",
            [
                "type": "object",
                "properties": ["visible": ["type": "boolean"]],
                "required": ["visible"],
                "additionalProperties": false,
            ]
        ),
        tool(
            "statusBar.setIcon",
            "Set the status item SF Symbol",
            [
                "type": "object",
                "properties": ["symbol": ["type": "string", "minLength": 1, "maxLength": 128]],
                "required": ["symbol"],
                "additionalProperties": false,
            ]
        ),
    ]

    private static func tool(_ name: String, _ description: String, _ inputSchema: [String: Any]) -> [String: Any] {
        [
            "name": name,
            "description": description,
            "inputSchema": inputSchema,
            "outputSchema": ["type": "object"],
        ]
    }
}
