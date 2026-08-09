import AppKit
import FIAHostCore
import Foundation

@MainActor
final class HostController {
    var onEvent: ((String, Any?) -> Void)?
    var onRetry: (() -> Void)?

    private let statusItem: StatusBarController
    private let webviews: WebViewRegistry
    private let notifications: NotificationController
    private let dialogs: DialogController
    private let clipboard: ClipboardController
    private let keychain: KeychainController
    private let settingsStore: HostSettingsStore?
    private var settings: HostSettings

    init(configuration: HostConfiguration, settingsStore: HostSettingsStore?) {
        self.settingsStore = settingsStore
        settings = settingsStore?.load(fallbackSymbol: configuration.statusItem.symbol)
            ?? HostSettings(statusItemSymbol: configuration.statusItem.symbol)
        statusItem = StatusBarController(
            symbol: settings.statusItemSymbol,
            tooltip: configuration.statusItem.tooltip
        )
        webviews = WebViewRegistry(
            appName: configuration.app.name,
            inspectable: configuration.development,
            storedFrames: settings.windowFrames
        )
        notifications = NotificationController(diagnostic: { message in
            guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
            try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
        })
        dialogs = DialogController()
        clipboard = ClipboardController()
        keychain = KeychainController(service: configuration.app.identifier)
        statusItem.onLeftClick = { [weak self] in self?.onEvent?("statusItem.clicked", ["button": "left"]) }
        statusItem.onAction = { [weak self] id in self?.onEvent?("statusItem.action", ["id": id]) }
        statusItem.onQuit = { NSApp.terminate(nil) }
        statusItem.onRetry = { [weak self] in self?.onRetry?() }
        webviews.onEvent = { [weak self] payload in self?.onEvent?("webviews.event", payload) }
        notifications.onEvent = { [weak self] payload in self?.onEvent?("notifications.clicked", payload) }
        webviews.onFramesChanged = { [weak self] frames in
            self?.settings.windowFrames = frames
            self?.persist()
        }
    }

    func start() {
        applyActivationPolicy()
        if !statusItem.setSymbol(settings.statusItemSymbol) {
            settings.statusItemSymbol = "circle.grid.2x2.fill"
            _ = statusItem.setSymbol(settings.statusItemSymbol)
        }
        statusItem.showStarting()
        statusItem.setVisible(true)
        persist()
    }

    func showStarting() {
        notifications.setBackendReady(false)
        statusItem.showStarting()
        statusItem.setVisible(true)
    }

    func showReady() {
        notifications.setBackendReady(true)
        statusItem.showReadyIfStarting()
        statusItem.setVisible(settings.statusItemVisible)
    }

    func showFailure(_ reason: String) {
        notifications.setBackendReady(false)
        statusItem.showFailure(reason)
        statusItem.setVisible(true)
    }

    func applicationReopened() {
        onEvent?("application.reopen", [:])
        _ = webviews.focusFirstWindow()
    }

    func execute(method: String, params: [String: Any]) async throws -> Any? {
        if method.hasPrefix("webviews.") { return try webviews.execute(method: method, params: params) }
        if method.hasPrefix("notifications.") {
            return try await notifications.execute(method: method, params: params)
        }
        if method.hasPrefix("dialogs.") { return try await dialogs.execute(method: method, params: params) }
        if method.hasPrefix("clipboard.") { return try clipboard.execute(method: method, params: params) }
        if method.hasPrefix("keychain.") { return try keychain.execute(method: method, params: params) }
        switch method {
        case "application.getState": return applicationState()
        case "application.quit":
            DispatchQueue.main.async { NSApp.terminate(nil) }
            return nil
        case "application.setDockVisible":
            guard let visible = params["visible"] as? Bool else { throw invalid("visible must be a boolean") }
            try setDockVisible(visible)
            return applicationState()
        case "statusItem.setVisible":
            guard let visible = params["visible"] as? Bool else { throw invalid("visible must be a boolean") }
            try setStatusItemVisible(visible)
            return applicationState()
        case "statusItem.setSymbol":
            guard let symbol = params["symbol"] as? String, !symbol.isEmpty, symbol.count <= 128,
                  statusItem.setSymbol(symbol) else { throw invalid("symbol must name an existing SF Symbol") }
            settings.statusItemSymbol = symbol
            persist()
            return nil
        case "statusItem.setTooltip":
            guard let tooltip = params["tooltip"] as? String, !tooltip.isEmpty, tooltip.count <= 512 else {
                throw invalid("tooltip must be a non-empty string")
            }
            statusItem.setTooltip(tooltip)
            return nil
        case "statusItem.setMenu":
            try statusItem.setMenu(params["menu"])
            return nil
        case "statusItem.updateMenuItem":
            guard let id = params["id"] as? String else { throw invalid("id must be a string") }
            try statusItem.updateMenuItem(id: id, patch: params["patch"])
            return nil
        case "system.openURL":
            guard let raw = params["url"] as? String, let url = URL(string: raw),
                  url.scheme == "http" || url.scheme == "https", url.host != nil,
                  url.user == nil, url.password == nil else { throw invalid("URL must be HTTP(S)") }
            guard NSWorkspace.shared.open(url) else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "macOS could not open the URL")
            }
            return nil
        default: throw HostRequestExecutionError(code: .invalidRequest, message: "unknown Host method: \(method)")
        }
    }

    func flushSettings() {
        settings.windowFrames = webviews.currentFrames()
        settingsStore?.flush(settings)
    }

    private func applicationState() -> [String: Any] {
        ["dockVisible": settings.dockVisible, "statusItemVisible": settings.statusItemVisible]
    }

    private func setDockVisible(_ visible: Bool) throws {
        guard visible || settings.statusItemVisible else {
            throw HostRequestExecutionError(code: .unsafeState, message: "Dock and status item cannot both be hidden")
        }
        let policy: NSApplication.ActivationPolicy = visible ? .regular : .accessory
        guard NSApp.activationPolicy() == policy || NSApp.setActivationPolicy(policy) else {
            throw HostRequestExecutionError(code: .nativeFailure, message: "could not change Dock visibility")
        }
        settings.dockVisible = visible
        persist()
    }

    private func setStatusItemVisible(_ visible: Bool) throws {
        guard visible || settings.dockVisible else {
            throw HostRequestExecutionError(code: .unsafeState, message: "Dock and status item cannot both be hidden")
        }
        statusItem.setVisible(visible)
        settings.statusItemVisible = visible
        persist()
    }

    private func applyActivationPolicy() {
        let policy: NSApplication.ActivationPolicy = settings.dockVisible ? .regular : .accessory
        if NSApp.activationPolicy() != policy, !NSApp.setActivationPolicy(policy) {
            diagnostic("could not apply activation policy")
        }
    }

    private func persist() { settingsStore?.scheduleSave(settings) }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}
