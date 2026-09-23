import AppKit
import Foundation

public enum FIAApplication {
    /// Schedule outside a main-dispatch callback: AppKit's terminateLater loop must
    /// remain able to service the main queue while asynchronous cleanup runs.
    @MainActor
    public static func requestQuit() {
        RunLoop.main.perform(inModes: [.common]) {
            MainActor.assumeIsolated { NSApp.terminate(nil) }
        }
        CFRunLoopWakeUp(CFRunLoopGetMain())
    }

    @MainActor
    public static func run() {
        do {
            if CommandLine.arguments.dropFirst().first == "--cli" { try AgentCLI.run() }
            if CommandLine.arguments.dropFirst().first == "icon" {
                try renderIcon(arguments: [CommandLine.arguments[0]] + Array(CommandLine.arguments.dropFirst(2)))
                return
            }
            let manifest = try RuntimeManifest.load()
            let runtime = try FIARuntime(manifest: manifest)
            let application = NSApplication.shared
            let headless = CommandLine.arguments.contains("--agent-background")
            let delegate = ApplicationDelegate(runtime: runtime, manifest: manifest, headless: headless)
            application.delegate = delegate
            application.setActivationPolicy(headless ? .accessory : .regular)
            application.run()
            withExtendedLifetime(delegate) {}
        } catch {
            if CommandLine.arguments.contains("--agent-background") { AgentCLI.recordStartupFailure(error) }
            fputs("FIA: " + error.localizedDescription + "\n", stderr)
            exit(1)
        }
    }
}

@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private let runtime: FIARuntime
    private let manifest: RuntimeManifest
    private var headless: Bool
    private(set) var statusItem: NSStatusItem?
    private var stopping = false
    private var menuInstalled = false

    init(runtime: FIARuntime, manifest: RuntimeManifest, headless: Bool) {
        self.runtime = runtime
        self.manifest = manifest
        self.headless = headless
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        runtime.onShow = { [weak self] in self?.showApplication() }
        installStatusItem()
        if !headless { installMenu() }
        Task { @MainActor in
            do {
                try await runtime.start(background: headless)
                AgentCLI.clearStartupFailure(identifier: manifest.app.identifier)
                if !headless { NSApp.activate(ignoringOtherApps: true) }
            } catch {
                AgentCLI.recordStartupFailure(error)
                if headless { fputs("FIA startup: \(error.localizedDescription)\n", stderr); NSApp.terminate(nil) }
                else { NSAlert(error: error).runModal() }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !stopping else { return .terminateLater }
        stopping = true
        Task { @MainActor in
            let report = await runtime.stop()
            sender.reply(toApplicationShouldTerminate: report.completed)
            if !report.completed {
                stopping = false
                let message = report.issues.map(\.message).joined(separator: "\n")
                if headless { fputs("FIA shutdown: \(message)\n", stderr) }
                else { NSAlert(error: ManagedProcessError(message)).runModal() }
            }
        }
        return .terminateLater
    }

    func installMenu() {
        guard !headless, !menuInstalled else { return }
        menuInstalled = true
        let main = NSMenu()
        let applicationItem = NSMenuItem(title: manifest.app.name, action: nil, keyEquivalent: "")
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "About \(manifest.app.name)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        if runtime.updater.isEnabled {
            applicationMenu.addItem(.separator())
            let update = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
            update.target = self
            applicationMenu.addItem(update)
        }
        let install = NSMenuItem(title: "Install Command Line Tool…", action: #selector(installCLI), keyEquivalent: "")
        install.target = self
        applicationMenu.addItem(install)
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Hide \(manifest.app.name)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = applicationMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        applicationMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Quit \(manifest.app.name)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationItem.submenu = applicationMenu
        main.addItem(applicationItem)

        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = main
    }

    func installStatusItem() {
        guard let configuration = manifest.statusItem else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: configuration.symbol, accessibilityDescription: configuration.tooltip)
        item.button?.toolTip = configuration.tooltip
        let menu = NSMenu()
        let show = NSMenuItem(title: "Show", action: #selector(showMainWindow), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        let install = NSMenuItem(title: "Install Command Line Tool…", action: #selector(installCLI), keyEquivalent: "")
        install.target = self
        menu.addItem(install)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard runtime.lifecycle == .running else { return false }
        showApplication()
        return false
    }

    private func showApplication() {
        headless = false
        NSApp.setActivationPolicy(.regular)
        installMenu()
        try? runtime.presentMainWindow()
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func showMainWindow() { showApplication() }
    @objc private func installCLI() {
        Task { @MainActor in
            do {
                let result = try await runtime.manageCLI("install")
                let alert = NSAlert(); alert.messageText = "Command installed"
                alert.informativeText = result.pathHint ?? result.path
                alert.runModal()
            } catch { NSAlert(error: error).runModal() }
        }
    }
    @objc private func checkForUpdates() { Task { await runtime.updater.checkAndPrompt() } }
}
