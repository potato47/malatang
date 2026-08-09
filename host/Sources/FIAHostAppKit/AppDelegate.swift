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

    func applicationDidFinishLaunching(_ notification: Notification) {
        installTerminationSignalHandlers()
        do {
            guard let configurationURL = Bundle.main.url(forResource: "fia-config", withExtension: "json") else {
                throw HostStartupError.missingConfiguration
            }
            let configuration = try HostConfiguration.load(from: configurationURL)
            installMainMenu(applicationName: configuration.app.name)
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
                    return try hostController.execute(method: method, params: params)
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

    private func installMainMenu(applicationName: String) {
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
        NSApp.mainMenu = mainMenu
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

enum HostStartupError: Error, LocalizedError {
    case missingConfiguration

    var errorDescription: String? {
        switch self {
        case .missingConfiguration: "Contents/Resources/fia-config.json is missing"
        }
    }
}
