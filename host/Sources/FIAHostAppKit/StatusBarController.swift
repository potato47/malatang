import AppKit

@MainActor
final class StatusBarController: NSObject {
    var onLeftClick: (() -> Void)?
    var onToggleWindow: (() -> Void)?
    var onQuit: (() -> Void)?

    private let tooltip: String
    private var statusItem: NSStatusItem?
    private var symbol: String
    private var windowVisible = true

    init(symbol: String, tooltip: String) {
        self.symbol = symbol
        self.tooltip = tooltip
        super.init()
    }

    func setVisible(_ visible: Bool) {
        if visible {
            let item = ensureStatusItem()
            item.isVisible = true
        } else {
            statusItem?.isVisible = false
        }
    }

    func setSymbol(_ value: String) -> Bool {
        guard let image = NSImage(systemSymbolName: value, accessibilityDescription: tooltip) else { return false }
        image.isTemplate = true
        symbol = value
        statusItem?.button?.image = image
        return true
    }

    func updateWindowVisible(_ visible: Bool) {
        windowVisible = visible
    }

    private func ensureStatusItem() -> NSStatusItem {
        if let statusItem { return statusItem }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = item.button else {
            statusItem = item
            return item
        }
        button.target = self
        button.action = #selector(statusItemPressed(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.toolTip = tooltip
        statusItem = item
        _ = setSymbol(symbol)
        return item
    }

    @objc private func statusItemPressed(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            showMenu(for: sender, event: event)
            return
        }
        onLeftClick?()
        onToggleWindow?()
    }

    private func showMenu(for button: NSStatusBarButton, event: NSEvent) {
        NSMenu.popUpContextMenu(makeMenu(), with: event, for: button)
    }

    func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        let toggle = NSMenuItem(
            title: windowVisible ? "Hide Window" : "Show Window",
            action: #selector(toggleWindowFromMenu(_:)),
            keyEquivalent: ""
        )
        toggle.target = self
        toggle.isEnabled = true
        menu.addItem(toggle)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit", action: #selector(quitFromMenu(_:)), keyEquivalent: "q")
        quit.target = self
        quit.isEnabled = true
        menu.addItem(quit)
        return menu
    }

    @objc private func toggleWindowFromMenu(_ sender: Any?) {
        onToggleWindow?()
    }

    @objc private func quitFromMenu(_ sender: Any?) {
        onQuit?()
    }
}
