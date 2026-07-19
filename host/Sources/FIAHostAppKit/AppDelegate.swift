import AppKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var configuration: HostConfiguration?
    private var windowController: HostWindowController?
    private var desktopController: DesktopController?
    private var runtime: RuntimeSupervisor?
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

            let runtime = RuntimeSupervisor(configuration: configuration) { [weak self] event in
                self?.handleRuntimeEvent(event)
            }
            self.runtime = runtime
            runtime.start()
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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        configuration?.window.closeBehavior == .quit
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        desktopController?.showAndFocusWindow()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        diagnostic("applicationShouldTerminate invoked")
        guard let runtime, runtime.isRunning else { return .terminateNow }
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        desktopController?.flushSettings()
        runtime.stop {
            self.diagnostic("runtime stop completed; replying to AppKit termination")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminationSignalSources.forEach { $0.cancel() }
        terminationSignalSources.removeAll()
        desktopController?.flushSettings()
        runtime?.forceStop()
    }

    private func handleRuntimeEvent(_ event: RuntimeSupervisor.Event) {
        switch event {
        case let .ready(bootstrapURL):
            windowController?.showWebView(bootstrapURL: bootstrapURL) { [weak desktopController] command in
                guard let desktopController else {
                    throw NativeCommandExecutionError(
                        code: .bridgeUnavailable,
                        message: "The desktop controller is unavailable"
                    )
                }
                return try desktopController.execute(command)
            }
            scheduleInternalAutoQuitIfRequested()
        case let .failed(title, detail):
            showRuntimeFailure(title: title, detail: detail)
        }
    }

    private func showRuntimeFailure(title: String, detail: String) {
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

    var errorDescription: String? { "Contents/Resources/fia-config.json is missing" }
}
