import AppKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: HostWindowController?
    private var desktopController: DesktopController?
    private var runtime: RuntimeSupervisor?
    private var backend: BackendSupervisor?
    private var configuration: HostConfiguration?
    private var pendingBootstrapURL: URL?
    private var webViewInstalled = false
    private var backendFailurePresented = false
    private var terminationPending = false
    private var autoQuitScheduled = false
    private var terminationSignalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        installTerminationSignalHandlers()

        do {
            guard let configurationURL = Bundle.main.url(forResource: "fia-config", withExtension: "json") else {
                throw HostStartupError.missingConfiguration
            }
            let configuration = try HostConfiguration.load(from: configurationURL)
            self.configuration = configuration
            installMainMenu(applicationName: configuration.app.name)

            let settingsStore = try? DesktopSettingsStore(
                identifier: configuration.app.identifier,
                diagnostic: { [weak self] message in self?.diagnostic(message) }
            )
            let settings = settingsStore?.load()
            var initialState = DesktopState(configuration: configuration)
            if let settings {
                do {
                    initialState = try settings.applying(to: initialState)
                } catch {
                    diagnostic("ignoring unsafe desktop settings: \(error.localizedDescription)")
                }
            }

            let windowController = HostWindowController(
                configuration: configuration,
                restoredFrame: settings?.windowFrame
            )
            self.windowController = windowController
            windowController.onWebFailure = { [weak self] detail in
                self?.showRuntimeFailure(title: "Web content failed to load", detail: detail)
            }

            let desktopController = DesktopController(
                configuration: configuration,
                initialState: initialState,
                windowController: windowController,
                settingsStore: settingsStore
            )
            self.desktopController = desktopController
            desktopController.onStateChanged = { [weak windowController] state in
                guard let payload = try? NativeBridgeHandler.stateChangedEvent(state) else { return }
                windowController?.emitNativeEvent(payload)
            }
            desktopController.onStatusBarClicked = { [weak windowController] in
                windowController?.emitNativeEvent(NativeBridgeHandler.statusBarClickedEvent)
            }
            desktopController.start()

            if configuration.app.mode != .statusBar {
                windowController.show()
                windowController.focus()
            }

            if configuration.backend.isEnabled {
                let backend = BackendSupervisor(configuration: configuration) { [weak self] event in
                    self?.handleBackendEvent(event)
                }
                self.backend = backend
                if configuration.backend.isDevelopment { installBackendReloadSignalHandler() }
                backend.start()
            }

            if !configuration.runtime.isBundled {
                let runtime = RuntimeSupervisor(configuration: configuration) { [weak self] event in
                    self?.handleRuntimeEvent(event)
                }
                self.runtime = runtime
                runtime.start()
            }
            try showApplicationIfReady()
        } catch {
            NSApp.setActivationPolicy(.regular)
            installMainMenu(applicationName: "FIA Host")
            let windowController = HostWindowController(configuration: nil)
            self.windowController = windowController
            windowController.showFailure(
                title: "FIA Host could not start",
                detail: error.localizedDescription,
                onRetry: nil,
                onQuit: { NSApp.terminate(nil) }
            )
            windowController.focus()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        desktopController?.showAndFocusWindow()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        diagnostic("applicationShouldTerminate invoked")
        guard !terminationPending else { return .terminateLater }
        desktopController?.flushSettings()
        let runningRuntime = runtime?.isRunning == true
        let runningBackend = backend?.isRunning == true
        guard runningRuntime || runningBackend else { return .terminateNow }
        terminationPending = true
        var remaining = (runningRuntime ? 1 : 0) + (runningBackend ? 1 : 0)
        let completed: () -> Void = { [weak self] in
            remaining -= 1
            guard remaining == 0 else { return }
            self?.diagnostic("all managed processes stopped; replying to AppKit termination")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        if runningRuntime { runtime?.stop(completion: completed) }
        if runningBackend { backend?.stop(completion: completed) }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminationSignalSources.forEach { $0.cancel() }
        terminationSignalSources.removeAll()
        desktopController?.flushSettings()
        runtime?.forceStop()
        backend?.forceStop()
    }

    private func handleRuntimeEvent(_ event: RuntimeSupervisor.Event) {
        switch event {
        case let .ready(bootstrapURL):
            pendingBootstrapURL = bootstrapURL
            do { try showApplicationIfReady() } catch { showRuntimeFailure(title: "UI could not start", detail: error.localizedDescription) }
        case let .failed(title, detail):
            showRuntimeFailure(title: title, detail: detail)
        case let .applicationEvent(name, payload):
            windowController?.emitBackendEvent(name: name, payload: payload)
        }
    }

    private func handleBackendEvent(_ event: BackendSupervisor.Event) {
        switch event {
        case .ready:
            backendFailurePresented = false
            do { try showApplicationIfReady() } catch { showBackendFailure(title: "Swift backend could not start", detail: error.localizedDescription) }
        case let .applicationEvent(name, payload):
            windowController?.emitBackendEvent(name: name, payload: payload)
        case let .failed(title, detail):
            showBackendFailure(title: title, detail: detail)
        }
    }

    private func showApplicationIfReady() throws {
        guard !webViewInstalled, let configuration else { return }
        guard !configuration.backend.isEnabled || backend?.isReady == true else { return }
        let backendInvoke = backendCommandExecutor()
        if configuration.runtime.isBundled {
            try showBundledApplication(configuration: configuration, backendInvoke: backendInvoke)
        } else {
            guard let bootstrapURL = pendingBootstrapURL else { return }
            windowController?.showWebView(
                bootstrapURL: bootstrapURL,
                backendInvoke: backendInvoke,
                execute: nativeCommandExecutor()
            )
        }
        webViewInstalled = true
        scheduleInternalAutoQuitIfRequested()
    }

    private func showBundledApplication(
        configuration: HostConfiguration,
        backendInvoke: ((BackendBridgeRequest) async throws -> Data)?
    ) throws {
        guard let resources = Bundle.main.resourceURL,
              let entry = configuration.runtime.entry
        else { throw HostStartupError.missingBundledUI }
        let components = entry.split(separator: "/").map(String.init)
        guard components.count >= 2, components.first == "UI" else {
            throw HostStartupError.invalidBundledUIEntry
        }
        let relativeEntry = components.dropFirst().joined(separator: "/")
        let root = resources.appendingPathComponent("UI", isDirectory: true)
        windowController?.showBundledWebView(
            rootDirectory: root,
            entry: relativeEntry,
            backendInvoke: backendInvoke,
            execute: nativeCommandExecutor()
        )
    }

    private func backendCommandExecutor() -> ((BackendBridgeRequest) async throws -> Data)? {
        if let backend {
            return { [weak backend] request in
                guard let backend else {
                    throw BackendInvocationError(
                        code: .backendUnavailable,
                        message: "The FIA Swift backend is unavailable"
                    )
                }
                return try await backend.invoke(request)
            }
        }
        guard configuration?.backend.usesRuntime == true, let runtime else { return nil }
        return { [weak runtime] request in
            guard let runtime else {
                throw BackendInvocationError(
                    code: .backendUnavailable,
                    message: "The FIA Bun backend is unavailable"
                )
            }
            return try await runtime.invoke(request)
        }
    }

    private func nativeCommandExecutor() -> (NativeBridgeCommand) throws -> DesktopState {
        { [weak desktopController] command in
            guard let desktopController else {
                throw NativeCommandExecutionError(
                    code: .bridgeUnavailable,
                    message: "The desktop controller is unavailable"
                )
            }
            return try desktopController.execute(command)
        }
    }

    private func showRuntimeFailure(title: String, detail: String) {
        webViewInstalled = false
        pendingBootstrapURL = nil
        windowController?.showFailure(
            title: title,
            detail: detail,
            onRetry: { [weak self] in
                self?.windowController?.showLoading("Restarting FIA runtime…")
                self?.runtime?.restart()
            },
            onQuit: { NSApp.terminate(nil) }
        )
        desktopController?.showAndFocusWindow()
    }

    private func showBackendFailure(title: String, detail: String) {
        guard webViewInstalled else {
            windowController?.showFailure(
                title: title,
                detail: detail,
                onRetry: { [weak self] in
                    self?.windowController?.showLoading("Restarting Swift backend…")
                    self?.backend?.restart()
                },
                onQuit: { NSApp.terminate(nil) }
            )
            desktopController?.showAndFocusWindow()
            return
        }
        guard !backendFailurePresented, let window = windowController?.window else { return }
        backendFailurePresented = true
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: "Restart Backend")
        alert.addButton(withTitle: "Quit")
        alert.beginSheetModal(for: window) { [weak self] response in
            self?.backendFailurePresented = false
            if response == .alertFirstButtonReturn {
                self?.backend?.restart()
            } else {
                NSApp.terminate(nil)
            }
        }
    }

    private func scheduleInternalAutoQuitIfRequested() {
        guard !autoQuitScheduled,
              let raw = ProcessInfo.processInfo.environment["FIA_INTERNAL_AUTO_QUIT_MS"],
              let milliseconds = UInt64(raw),
              milliseconds > 0
        else { return }
        autoQuitScheduled = true
        diagnostic("scheduling internal auto quit after \(milliseconds) ms")
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(milliseconds))
            self.diagnostic("requesting internal auto quit")
            NSApp.terminate(nil)
        }
    }

    private func installTerminationSignalHandlers() {
        for signalNumber in [SIGINT, SIGTERM] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler {
                NSApp.terminate(nil)
            }
            source.resume()
            terminationSignalSources.append(source)
        }
    }

    private func installBackendReloadSignalHandler() {
        Darwin.signal(SIGUSR1, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        source.setEventHandler { [weak self] in
            self?.diagnostic("received Swift backend reload signal")
            self?.backend?.restart()
        }
        source.resume()
        terminationSignalSources.append(source)
    }

    private func installMainMenu(applicationName: String) {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "Quit \(applicationName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private enum HostStartupError: Error, LocalizedError {
    case missingConfiguration
    case missingBundledUI
    case invalidBundledUIEntry

    var errorDescription: String? {
        switch self {
        case .missingConfiguration: "Contents/Resources/fia-config.json is missing"
        case .missingBundledUI: "The bundled UI entry is missing"
        case .invalidBundledUIEntry: "The bundled UI entry must be inside Contents/Resources/UI"
        }
    }
}
