import AppKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var hostController: HostController?
    private var supervisor: BackendSupervisor?
    private var terminationSignalSources: [DispatchSourceSignal] = []
    private var terminationPending = false
    private var autoQuitScheduled = false
    private var developmentActionID: String?
    private var developmentActionHandled = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        installTerminationSignalHandlers()
        do {
            guard let configurationURL = Bundle.main.url(forResource: "fia-config", withExtension: "json") else {
                throw HostStartupError.missingConfiguration
            }
            let configuration = try HostConfiguration.load(from: configurationURL)
            if configuration.development {
                developmentActionID = ProcessInfo.processInfo.environment["FIA_INTERNAL_EMIT_ACTION"]
            }
            NSApp.mainMenu = Self.makeMainMenu(applicationName: configuration.app.name)
            let settingsStore = try? HostSettingsStore(
                identifier: configuration.app.identifier,
                diagnostic: { [weak self] message in self?.diagnostic(message) }
            )
            let hostController = HostController(configuration: configuration, settingsStore: settingsStore)
            self.hostController = hostController
            let supervisor = try BackendSupervisor(
                configuration: configuration,
                onRequest: { [weak hostController] method, params in
                    guard let hostController else {
                        throw HostRequestExecutionError(code: .nativeFailure, message: "Host controller is unavailable")
                    }
                    return try await hostController.execute(method: method, params: params)
                },
                onState: { [weak self, weak hostController] state in
                    self?.backendStateChanged(state, hostController: hostController)
                }
            )
            self.supervisor = supervisor
            hostController.onEvent = { [weak supervisor] event, payload in
                supervisor?.sendEvent(event, payload: payload)
            }
            hostController.onRetry = { [weak supervisor] in supervisor?.retry() }
            hostController.start()
            supervisor.start()
            scheduleInternalAutoQuitIfRequested()
        } catch {
            showStartupFailure(error)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        hostController?.applicationReopened()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        hostController?.flushSettings()
        guard supervisor != nil else { return .terminateNow }
        guard !terminationPending else { return .terminateCancel }
        guard supervisor?.stop() == true else { return .terminateNow }
        terminationPending = true
        return .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminationSignalSources.forEach { $0.cancel() }
        terminationSignalSources.removeAll()
        hostController?.flushSettings()
    }

    private func backendStateChanged(_ state: BackendSupervisor.State, hostController: HostController?) {
        switch state {
        case .starting, .restarting:
            hostController?.showStarting()
        case .ready:
            hostController?.showReady()
            emitDevelopmentActionIfRequested(hostController)
        case let .failed(reason):
            hostController?.showFailure(reason)
        case .stopping:
            break
        case .stopped:
            guard terminationPending else { return }
            terminationPending = false
            NSApp.terminate(nil)
        }
    }

    private func showStartupFailure(_ error: Error) {
        diagnostic("startup failed: \(error.localizedDescription)")
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "FIA could not start"
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func emitDevelopmentActionIfRequested(_ hostController: HostController?) {
        guard !developmentActionHandled, let id = developmentActionID else { return }
        developmentActionHandled = true
        do {
            guard let hostController else {
                throw HostRequestExecutionError(code: .nativeFailure, message: "Host controller is unavailable")
            }
            try hostController.emitStatusItemActionForDevelopment(id: id)
            writeDevelopmentMarker("FIA_DEV_ACTION_EMITTED=\(id)")
        } catch {
            let reason = error.localizedDescription.replacingOccurrences(of: "\n", with: " ")
            writeDevelopmentMarker("FIA_DEV_ACTION_ERROR=\(id): \(reason)")
        }
    }

    private func writeDevelopmentMarker(_ value: String) {
        try? FileHandle.standardError.write(contentsOf: Data("\(value)\n".utf8))
    }

    static func makeMainMenu(applicationName: String) -> NSMenu {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: applicationName)
        let quit = NSMenuItem(
            title: "Quit \(applicationName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenu.addItem(quit)
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addCommand(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addCommand(
            title: "Redo",
            action: Selector(("redo:")),
            keyEquivalent: "z",
            modifiers: [.command, .shift]
        )
        editMenu.addItem(.separator())
        editMenu.addCommand(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addCommand(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addCommand(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addCommand(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        return mainMenu
    }

    private func installTerminationSignalHandlers() {
        for signal in [SIGINT, SIGTERM] {
            Darwin.signal(signal, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signal, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            terminationSignalSources.append(source)
        }
    }

    private func scheduleInternalAutoQuitIfRequested() {
        guard !autoQuitScheduled,
              let value = ProcessInfo.processInfo.environment["FIA_INTERNAL_AUTO_QUIT_MS"],
              let milliseconds = UInt64(value), milliseconds > 0 else { return }
        autoQuitScheduled = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(milliseconds))
            NSApp.terminate(nil)
        }
    }

    private func diagnostic(_ message: String) {
        guard ProcessInfo.processInfo.environment["FIA_INTERNAL_DIAGNOSTICS"] == "1" else { return }
        try? FileHandle.standardError.write(contentsOf: Data("FIAHost: \(message)\n".utf8))
    }
}

private extension NSMenu {
    func addCommand(
        title: String,
        action: Selector,
        keyEquivalent: String,
        modifiers: NSEvent.ModifierFlags = [.command]
    ) {
        let item = addItem(withTitle: title, action: action, keyEquivalent: keyEquivalent)
        item.keyEquivalentModifierMask = modifiers
    }
}

enum HostStartupError: Error, LocalizedError {
    case missingConfiguration

    var errorDescription: String? {
        switch self {
        case .missingConfiguration: "Contents/Resources/fia-config.json is missing"
        }
    }
}
