import AppKit
import Darwin
import FIAHostCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: HostWindowController?
    private var desktopController: DesktopController?
    private var nativeServer: NativeMCPServer?
    private var supervisor: MCPServerSupervisor?
    private var configuration: HostConfiguration?
    private var terminationSignalSources: [DispatchSourceSignal] = []
    private var developmentControlBuffer = Data()
    private var autoQuitScheduled = false

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
            let desktopController = DesktopController(
                configuration: configuration,
                initialState: initialState,
                windowController: windowController,
                settingsStore: settingsStore
            )
            self.desktopController = desktopController

            let nativeServer = NativeMCPServer { [weak desktopController] command in
                guard let desktopController else {
                    throw NativeCommandExecutionError(
                        code: .bridgeUnavailable,
                        message: "The desktop controller is unavailable"
                    )
                }
                return try desktopController.execute(command)
            }
            self.nativeServer = nativeServer

            let supervisor = MCPServerSupervisor(
                configuration: configuration,
                onMessage: { [weak windowController] serverID, message in
                    windowController?.emitMCPMessage(serverID: serverID, message: message)
                },
                onState: { [weak windowController] serverID, state, reason in
                    windowController?.emitMCPState(serverID: serverID, state: state.rawValue, reason: reason)
                }
            )
            self.supervisor = supervisor

            desktopController.onStateChanged = { [weak windowController, weak nativeServer] state in
                guard let object = try? Self.jsonObject(state) else { return }
                windowController?.emitNativeEvent(["type": "stateChanged", "state": object])
                for message in nativeServer?.resourceUpdatedNotifications() ?? [] {
                    windowController?.emitMCPMessage(serverID: NativeMCPServer.serverID, message: message)
                }
            }
            desktopController.onStatusBarClicked = { [weak windowController] in
                windowController?.emitNativeEvent(["type": "statusBarClicked", "button": "left"])
            }
            desktopController.start()

            windowController.onWebFailure = { [weak self] detail in
                self?.showWebFailure(detail)
            }
            windowController.onMainDocumentReload = { [weak supervisor] in
                supervisor?.restartAll()
                nativeServer.resetSubscriptions()
            }
            try showApplication(configuration: configuration)

            if configuration.app.mode != .statusBar {
                windowController.show()
                windowController.focus()
            }
            if configuration.ui.isDevelopment { installDevelopmentControlChannel() }
            scheduleInternalAutoQuitIfRequested()
        } catch {
            showStartupFailure(error)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        desktopController?.showAndFocusWindow()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        desktopController?.flushSettings()
        supervisor?.stopAll()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        FileHandle.standardInput.readabilityHandler = nil
        terminationSignalSources.forEach { $0.cancel() }
        terminationSignalSources.removeAll()
        desktopController?.flushSettings()
        supervisor?.stopAll()
    }

    private func showApplication(configuration: HostConfiguration) throws {
        let route: (MCPBridgeEnvelope) throws -> Void = { [weak self] envelope in
            guard let self else { throw HostStartupError.routerUnavailable }
            if envelope.serverID == NativeMCPServer.serverID {
                guard let response = self.nativeServer?.handle(envelope.message) else { return }
                self.windowController?.emitMCPMessage(serverID: envelope.serverID, message: response)
            } else {
                try self.supervisor?.send(serverID: envelope.serverID, data: envelope.data)
            }
        }
        switch configuration.ui.mode {
        case .development:
            guard let value = configuration.ui.url, let url = URL(string: value) else {
                throw HostStartupError.invalidDevelopmentURL
            }
            windowController?.showWebView(url: url, route: route)
        case .bundled:
            guard let resources = Bundle.main.resourceURL,
                  let entry = configuration.ui.entry
            else { throw HostStartupError.missingBundledUI }
            let parts = entry.split(separator: "/").map(String.init)
            guard parts.count >= 2, parts.first == "UI" else {
                throw HostStartupError.invalidBundledUIEntry
            }
            windowController?.showBundledWebView(
                rootDirectory: resources.appendingPathComponent("UI", isDirectory: true),
                entry: parts.dropFirst().joined(separator: "/"),
                route: route
            )
        }
    }

    private func installDevelopmentControlChannel() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            Task { @MainActor [weak self] in self?.consumeDevelopmentControl(data) }
        }
    }

    private func consumeDevelopmentControl(_ data: Data) {
        developmentControlBuffer.append(data)
        guard developmentControlBuffer.count <= 64 * 1024 else {
            developmentControlBuffer.removeAll()
            diagnostic("discarding oversized development control message")
            return
        }
        while let newline = developmentControlBuffer.firstIndex(of: 0x0A) {
            let line = developmentControlBuffer[..<newline]
            developmentControlBuffer.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  Set(value.keys) == Set(["type", "serverId"]),
                  value["type"] as? String == "restartMcpServer",
                  let serverID = value["serverId"] as? String,
                  MCPBridgeProtocol.validServerID(serverID),
                  serverID != NativeMCPServer.serverID
            else {
                diagnostic("ignoring invalid development control message")
                continue
            }
            supervisor?.restart(serverID: serverID)
        }
    }

    private func showWebFailure(_ detail: String) {
        supervisor?.restartAll()
        nativeServer?.resetSubscriptions()
        windowController?.showFailure(
            title: "Web content failed to load",
            detail: detail,
            onRetry: { [weak self] in
                guard let configuration = self?.configuration else { return }
                try? self?.showApplication(configuration: configuration)
            },
            onQuit: { NSApp.terminate(nil) }
        )
        desktopController?.showAndFocusWindow()
    }

    private func showStartupFailure(_ error: Error) {
        NSApp.setActivationPolicy(.regular)
        installMainMenu(applicationName: "FIA Host")
        let controller = HostWindowController(configuration: nil)
        windowController = controller
        controller.showFailure(
            title: "FIA Host could not start",
            detail: error.localizedDescription,
            onRetry: nil,
            onQuit: { NSApp.terminate(nil) }
        )
        controller.focus()
    }

    private func scheduleInternalAutoQuitIfRequested() {
        guard !autoQuitScheduled,
              let raw = ProcessInfo.processInfo.environment["FIA_INTERNAL_AUTO_QUIT_MS"],
              let milliseconds = UInt64(raw),
              milliseconds > 0
        else { return }
        autoQuitScheduled = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(milliseconds))
            NSApp.terminate(nil)
        }
    }

    private func installTerminationSignalHandlers() {
        for signalNumber in [SIGINT, SIGTERM] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
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

    private static func jsonObject<Value: Encodable>(_ value: Value) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
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
    case invalidDevelopmentURL
    case routerUnavailable

    var errorDescription: String? {
        switch self {
        case .missingConfiguration: "Contents/Resources/fia-config.json is missing"
        case .missingBundledUI: "The bundled UI entry is missing"
        case .invalidBundledUIEntry: "The bundled UI entry must be inside Contents/Resources/UI"
        case .invalidDevelopmentURL: "The UI development URL is invalid"
        case .routerUnavailable: "The MCP router is unavailable"
        }
    }
}
