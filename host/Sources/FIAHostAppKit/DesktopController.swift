import AppKit
import FIAHostCore

@MainActor
final class DesktopController {
    var onStateChanged: ((DesktopState) -> Void)?
    var onStatusBarClicked: (() -> Void)?

    private let configuration: HostConfiguration
    private let windowController: HostWindowController
    private let statusBarController: StatusBarController
    private let settingsStore: DesktopSettingsStore?
    private(set) var state: DesktopState

    init(
        configuration: HostConfiguration,
        initialState: DesktopState,
        windowController: HostWindowController,
        settingsStore: DesktopSettingsStore?
    ) {
        self.configuration = configuration
        state = initialState
        self.windowController = windowController
        self.settingsStore = settingsStore
        statusBarController = StatusBarController(
            symbol: initialState.statusBarSymbol,
            tooltip: configuration.statusBar.tooltip
        )

        windowController.onWindowStateChanged = { [weak self] in
            self?.synchronizeWindowState(emit: true)
        }
        windowController.onWindowFrameChanged = { [weak self] in
            self?.persist()
        }
        statusBarController.onLeftClick = { [weak self] in
            self?.onStatusBarClicked?()
        }
        statusBarController.onToggleWindow = { [weak self] in
            self?.toggleWindow()
        }
        statusBarController.onQuit = {
            NSApp.terminate(nil)
        }
    }

    func start() {
        applyActivationPolicy(state.dockVisible)
        if !statusBarController.setSymbol(state.statusBarSymbol) {
            state.statusBarSymbol = configuration.statusBar.symbol
            _ = statusBarController.setSymbol(state.statusBarSymbol)
        }
        statusBarController.setVisible(state.statusBarVisible)
        applyWindowFlags()
        synchronizeWindowState(emit: false)
        persist()
    }

    func execute(_ command: NativeMCPCommand) throws -> DesktopState {
        switch command {
        case .getState:
            synchronizeWindowState(emit: false)
        case .quit:
            DispatchQueue.main.async { NSApp.terminate(nil) }
        case .showDock:
            try setDockVisible(true)
        case .hideDock:
            try setDockVisible(false)
        case .showWindow:
            windowController.show()
        case .hideWindow:
            windowController.hide()
        case .focusWindow:
            windowController.focus()
        case let .setAlwaysOnTop(enabled):
            state.window.alwaysOnTop = enabled
            applyWindowFlags()
            commit()
        case let .setVisibleOnAllSpaces(enabled):
            state.window.visibleOnAllSpaces = enabled
            applyWindowFlags()
            commit()
        case let .setVisibleOverFullScreen(enabled):
            state.window.visibleOverFullScreen = enabled
            applyWindowFlags()
            commit()
        case let .setStatusBarVisible(visible):
            try setStatusBarVisible(visible)
        case let .setStatusBarIcon(symbol):
            guard statusBarController.setSymbol(symbol) else {
                throw NativeCommandExecutionError(
                    code: .invalidArgument,
                    message: "The requested SF Symbol does not exist"
                )
            }
            state.statusBarSymbol = symbol
            commit()
        }
        return state
    }

    func showAndFocusWindow() {
        windowController.focus()
    }

    func flushSettings() {
        settingsStore?.flush(state: state, windowFrame: persistedWindowFrame())
    }

    private func setDockVisible(_ visible: Bool) throws {
        var next = state
        try next.setDockVisible(visible)
        let policy: NSApplication.ActivationPolicy = visible ? .regular : .accessory
        guard NSApp.activationPolicy() == policy || NSApp.setActivationPolicy(policy) else {
            throw NativeCommandExecutionError(code: .nativeFailure, message: "Could not change Dock visibility")
        }
        state = next
        commit()
    }

    private func setStatusBarVisible(_ visible: Bool) throws {
        var next = state
        try next.setStatusBarVisible(visible)
        statusBarController.setVisible(visible)
        state = next
        commit()
    }

    private func toggleWindow() {
        if windowController.isWindowVisible {
            windowController.hide()
        } else {
            windowController.focus()
        }
    }

    private func applyActivationPolicy(_ dockVisible: Bool) {
        let policy: NSApplication.ActivationPolicy = dockVisible ? .regular : .accessory
        if NSApp.activationPolicy() != policy, !NSApp.setActivationPolicy(policy) {
            diagnostic("could not apply activation policy")
        }
    }

    private func applyWindowFlags() {
        guard let window = windowController.window else { return }
        window.level = state.window.alwaysOnTop ? .floating : .normal
        var behavior = window.collectionBehavior
        behavior.set(.canJoinAllSpaces, enabled: state.window.visibleOnAllSpaces)
        behavior.set(.fullScreenAuxiliary, enabled: state.window.visibleOverFullScreen)
        window.collectionBehavior = behavior
    }

    private func synchronizeWindowState(emit: Bool) {
        state.window.visible = windowController.isWindowVisible
        state.window.focused = windowController.isWindowFocused
        statusBarController.updateWindowVisible(state.window.visible)
        persist()
        if emit { onStateChanged?(state) }
    }

    private func commit() {
        synchronizeWindowState(emit: false)
        onStateChanged?(state)
    }

    private func persist() {
        settingsStore?.scheduleSave(state: state, windowFrame: persistedWindowFrame())
    }

    private func persistedWindowFrame() -> DesktopWindowFrame? {
        configuration.window.restoreState ? windowController.currentFrame : nil
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private extension NSWindow.CollectionBehavior {
    mutating func set(_ option: NSWindow.CollectionBehavior, enabled: Bool) {
        if enabled { insert(option) } else { remove(option) }
    }
}
