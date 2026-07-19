import AppKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var configuration: HostConfiguration?
    private var windowController: HostWindowController?
    private var runtime: RuntimeSupervisor?
    private var terminationPending = false
    private var autoQuitScheduled = false
    private var terminationSignalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        installTerminationSignalHandlers()
        NSApp.setActivationPolicy(.regular)

        do {
            guard let configurationURL = Bundle.main.url(forResource: "fia-config", withExtension: "json") else {
                throw HostStartupError.missingConfiguration
            }
            let configuration = try HostConfiguration.load(from: configurationURL)
            self.configuration = configuration
            installMainMenu(applicationName: configuration.app.name)
            let windowController = HostWindowController(configuration: configuration)
            self.windowController = windowController
            windowController.onWebFailure = { [weak self] detail in
                self?.showRuntimeFailure(title: "Web content failed to load", detail: detail)
            }
            windowController.showWindow(nil)
            windowController.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)

            let runtime = RuntimeSupervisor(configuration: configuration) { [weak self] event in
                self?.handleRuntimeEvent(event)
            }
            self.runtime = runtime
            runtime.start()
        } catch {
            installMainMenu(applicationName: "FIA Host")
            let windowController = HostWindowController(configuration: nil)
            self.windowController = windowController
            windowController.showFailure(
                title: "FIA Host could not start",
                detail: error.localizedDescription,
                onRetry: nil,
                onQuit: { NSApp.terminate(nil) }
            )
            windowController.showWindow(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        configuration?.app.quitOnLastWindowClosed ?? true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        diagnostic("applicationShouldTerminate invoked")
        guard let runtime, runtime.isRunning else { return .terminateNow }
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        runtime.stop {
            self.diagnostic("runtime stop completed; replying to AppKit termination")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminationSignalSources.forEach { $0.cancel() }
        terminationSignalSources.removeAll()
        runtime?.forceStop()
    }

    private func handleRuntimeEvent(_ event: RuntimeSupervisor.Event) {
        switch event {
        case let .ready(bootstrapURL):
            windowController?.showWebView(bootstrapURL: bootstrapURL)
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
