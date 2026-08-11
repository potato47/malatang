import AppKit
import FIAHostCore

@MainActor
final class StatusBarController: NSObject {
    var onLeftClick: (() -> Void)?
    var onAction: ((String) -> Void)?
    var onQuit: (() -> Void)?
    var onRetry: (() -> Void)?

    private var statusItem: NSStatusItem?
    private var symbol: String
    private var tooltip: String
    private var menuDefinition: [[String: Any]] = []

    init(symbol: String, tooltip: String) {
        self.symbol = symbol
        self.tooltip = tooltip
        super.init()
    }

    var isVisible: Bool { statusItem?.isVisible ?? false }

    func setVisible(_ visible: Bool) {
        if visible {
            let item = ensureStatusItem()
            item.isVisible = true
        } else {
            statusItem?.isVisible = false
        }
    }

    @discardableResult
    func setSymbol(_ value: String) -> Bool {
        guard let image = NSImage(systemSymbolName: value, accessibilityDescription: tooltip) else { return false }
        image.isTemplate = true
        symbol = value
        statusItem?.button?.image = image
        return true
    }

    func setTooltip(_ value: String) {
        tooltip = value
        statusItem?.button?.toolTip = value
    }

    func showStarting() {
        menuDefinition = [["type": "item", "id": "fia.starting", "title": "Starting…", "enabled": false]]
    }

    func showFailure(_ reason: String) {
        menuDefinition = [
            ["type": "item", "id": "fia.failed", "title": "Backend unavailable", "enabled": false],
            ["type": "item", "id": "fia.reason", "title": String(reason.prefix(160)), "enabled": false],
            ["type": "separator"],
            ["type": "item", "id": "fia.retry", "title": "Retry"],
        ]
    }

    func showReadyIfStarting() {
        guard menuDefinition.first?["id"] as? String == "fia.starting" else { return }
        menuDefinition = []
    }

    func setMenu(_ raw: Any?) throws {
        guard let values = raw as? [[String: Any]] else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "menu must be an array")
        }
        var ids = Set<String>()
        var count = 0
        try validate(values, depth: 1, ids: &ids, count: &count)
        menuDefinition = values
    }

    func updateMenuItem(id: String, patch: Any?) throws {
        guard !id.hasPrefix("fia.") else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "reserved status menu item ID: \(id)")
        }
        guard let patch = patch as? [String: Any] else {
            throw HostRequestExecutionError(code: .invalidArgument, message: "status menu item patch must be an object: \(id)")
        }
        let allowed = Set(["title", "enabled", "hidden", "checked", "symbol", "shortcut"])
        let unknown = Set(patch.keys).subtracting(allowed).sorted()
        guard unknown.isEmpty else {
            throw HostRequestExecutionError(
                code: .invalidArgument,
                message: "unknown status menu item patch field \(unknown.joined(separator: ", ")): \(id)"
            )
        }
        var candidate = menuDefinition
        guard update(id: id, patch: patch, nodes: &candidate) else {
            throw HostRequestExecutionError(code: .notFound, message: "status menu item not found: \(id)")
        }
        var ids = Set<String>()
        var count = 0
        try validate(candidate, depth: 1, ids: &ids, count: &count)
        menuDefinition = candidate
    }

    func emitActionForDevelopment(id: String) throws {
        guard let path = findItemPath(id: id, nodes: menuDefinition), let item = path.last else {
            throw HostRequestExecutionError(code: .notFound, message: "status menu item not found: \(id)")
        }
        guard item["children"] == nil else {
            throw HostRequestExecutionError(code: .unsafeState, message: "status menu item is a submenu: \(id)")
        }
        for node in path {
            let nodeID = node["id"] as? String ?? id
            guard node["hidden"] as? Bool != true else {
                throw HostRequestExecutionError(code: .unsafeState, message: "status menu item path is hidden at: \(nodeID)")
            }
            guard node["enabled"] as? Bool != false else {
                throw HostRequestExecutionError(code: .unsafeState, message: "status menu item path is disabled at: \(nodeID)")
            }
        }
        onAction?(id)
    }

    func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for node in menuDefinition {
            if let item = makeItem(node) { menu.addItem(item) }
        }
        if !menu.items.isEmpty, menu.items.last?.isSeparatorItem == false { menu.addItem(.separator()) }
        let quit = NSMenuItem(title: "Quit", action: #selector(quitPressed(_:)), keyEquivalent: "q")
        quit.keyEquivalentModifierMask = [.command]
        quit.target = self
        quit.isEnabled = true
        menu.addItem(quit)
        return menu
    }

    private func ensureStatusItem() -> NSStatusItem {
        if let statusItem { return statusItem }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.target = self
            button.action = #selector(statusItemPressed(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.toolTip = tooltip
        }
        statusItem = item
        _ = setSymbol(symbol)
        return item
    }

    @objc private func statusItemPressed(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            NSMenu.popUpContextMenu(makeMenu(), with: event, for: sender)
        } else {
            onLeftClick?()
        }
    }

    @objc private func menuItemPressed(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        if id == "fia.retry" { onRetry?() } else if !id.hasPrefix("fia.") { onAction?(id) }
    }

    @objc private func quitPressed(_ sender: Any?) { onQuit?() }

    private func makeItem(_ node: [String: Any]) -> NSMenuItem? {
        guard let type = node["type"] as? String else { return nil }
        if type == "separator" { return .separator() }
        guard type == "item", let id = node["id"] as? String, let title = node["title"] as? String else { return nil }
        let item = NSMenuItem(title: title, action: #selector(menuItemPressed(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = id
        item.isEnabled = node["enabled"] as? Bool ?? true
        item.isHidden = node["hidden"] as? Bool ?? false
        item.state = (node["checked"] as? Bool ?? false) ? .on : .off
        if let symbol = node["symbol"] as? String {
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
            item.image?.isTemplate = true
        }
        if let shortcut = node["shortcut"] as? [String: Any], let key = shortcut["key"] as? String {
            item.keyEquivalent = key.lowercased()
            item.keyEquivalentModifierMask = modifierMask(shortcut["modifiers"] as? [String] ?? [])
        }
        if let children = node["children"] as? [[String: Any]] {
            let submenu = NSMenu(title: title)
            submenu.autoenablesItems = false
            for child in children { if let childItem = makeItem(child) { submenu.addItem(childItem) } }
            item.submenu = submenu
            item.action = nil
        }
        return item
    }

    private func modifierMask(_ values: [String]) -> NSEvent.ModifierFlags {
        values.reduce(into: []) { result, value in
            switch value {
            case "command": result.insert(.command)
            case "option": result.insert(.option)
            case "control": result.insert(.control)
            case "shift": result.insert(.shift)
            default: break
            }
        }
    }

    private func validate(
        _ nodes: [[String: Any]],
        depth: Int,
        ids: inout Set<String>,
        count: inout Int
    ) throws {
        guard depth <= 8 else { throw HostRequestExecutionError(code: .invalidArgument, message: "menu exceeds eight levels") }
        for (index, node) in nodes.enumerated() {
            count += 1
            guard count <= 256 else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "menu exceeds 256 nodes")
            }
            guard let type = node["type"] as? String else {
                throw HostRequestExecutionError(
                    code: .invalidArgument,
                    message: "status menu node \(index) at depth \(depth) must have a string type"
                )
            }
            if type == "separator" {
                guard Set(node.keys) == ["type"] else {
                    throw HostRequestExecutionError(code: .invalidArgument, message: "separator has unknown fields")
                }
                continue
            }
            guard type == "item" else {
                throw HostRequestExecutionError(
                    code: .invalidArgument,
                    message: "unknown status menu node type \"\(type)\" at depth \(depth)"
                )
            }
            let allowed = Set(["type", "id", "title", "enabled", "hidden", "checked", "symbol", "shortcut", "children"])
            let unknown = Set(node.keys).subtracting(allowed).sorted()
            guard unknown.isEmpty else {
                let itemID = node["id"] as? String ?? "<missing ID>"
                throw HostRequestExecutionError(
                    code: .invalidArgument,
                    message: "unknown status menu item field \(unknown.joined(separator: ", ")) on item \"\(itemID)\""
                )
            }
            guard let id = node["id"] as? String else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "status menu item ID must be a string")
            }
            guard id.count <= 128,
                  id.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil
            else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "invalid status menu item ID: \(id)")
            }
            guard !id.hasPrefix("fia.") else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "reserved status menu item ID: \(id)")
            }
            guard !ids.contains(id) else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "duplicate status menu item ID: \(id)")
            }
            guard let title = node["title"] as? String, !title.isEmpty, title.count <= 256 else {
                throw HostRequestExecutionError(code: .invalidArgument, message: "invalid title on status menu item: \(id)")
            }
            for field in ["enabled", "hidden", "checked"] where node[field] != nil && !(node[field] is Bool) {
                throw HostRequestExecutionError(
                    code: .invalidArgument,
                    message: "\(field) must be a boolean on status menu item: \(id)"
                )
            }
            if node["symbol"] != nil {
                guard let symbol = node["symbol"] as? String, !symbol.isEmpty, symbol.count <= 128 else {
                    throw HostRequestExecutionError(
                        code: .invalidArgument,
                        message: "symbol must be a non-empty string on status menu item: \(id)"
                    )
                }
                guard NSImage(systemSymbolName: symbol, accessibilityDescription: nil) != nil else {
                    throw HostRequestExecutionError(
                        code: .invalidArgument,
                        message: "invalid SF Symbol name \"\(symbol)\" on item \"\(id)\""
                    )
                }
            }
            ids.insert(id)
            if let shortcut = node["shortcut"] as? [String: Any] {
                let modifiers = shortcut["modifiers"] as? [String]
                guard Set(shortcut.keys).isSubset(of: ["key", "modifiers"]) else {
                    throw HostRequestExecutionError(code: .invalidArgument, message: "unknown shortcut field on status menu item: \(id)")
                }
                guard let key = shortcut["key"] as? String, key.count == 1 else {
                    throw HostRequestExecutionError(code: .invalidArgument, message: "shortcut key must be one character on status menu item: \(id)")
                }
                guard shortcut["modifiers"] == nil || modifiers != nil,
                      (modifiers ?? []).allSatisfy({ ["command", "option", "control", "shift"].contains($0) })
                else {
                    throw HostRequestExecutionError(code: .invalidArgument, message: "invalid shortcut modifiers on status menu item: \(id)")
                }
            } else if node["shortcut"] != nil {
                throw HostRequestExecutionError(code: .invalidArgument, message: "shortcut must be an object on status menu item: \(id)")
            }
            if let children = node["children"] as? [[String: Any]] {
                try validate(children, depth: depth + 1, ids: &ids, count: &count)
            } else if node["children"] != nil {
                throw HostRequestExecutionError(code: .invalidArgument, message: "children must be an array on status menu item: \(id)")
            }
        }
    }

    private func findItemPath(id: String, nodes: [[String: Any]]) -> [[String: Any]]? {
        for node in nodes {
            if node["id"] as? String == id { return [node] }
            if let children = node["children"] as? [[String: Any]],
               let found = findItemPath(id: id, nodes: children) { return [node] + found }
        }
        return nil
    }

    private func update(id: String, patch: [String: Any], nodes: inout [[String: Any]]) -> Bool {
        for index in nodes.indices {
            if nodes[index]["id"] as? String == id {
                for (key, value) in patch {
                    if value is NSNull { nodes[index].removeValue(forKey: key) } else { nodes[index][key] = value }
                }
                return true
            }
            if var children = nodes[index]["children"] as? [[String: Any]], update(id: id, patch: patch, nodes: &children) {
                nodes[index]["children"] = children
                return true
            }
        }
        return false
    }
}
