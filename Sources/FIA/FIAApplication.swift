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
    public static func run(configure: (FIARuntime) throws -> Void) {
        do {
            let manifest = try RuntimeManifest.load()
            let runtime = try FIARuntime(manifest: manifest)
            try configure(runtime)
            runtime.finishConfiguration()
            let application = NSApplication.shared
            let headless = ProcessInfo.processInfo.environment["FIA_HEADLESS"] == "1"
            let delegate = ApplicationDelegate(runtime: runtime, manifest: manifest, headless: headless)
            application.delegate = delegate
            application.setActivationPolicy(headless || manifest.app.activationPolicy == "accessory" ? .accessory : .regular)
            application.run()
            withExtendedLifetime(delegate) {}
        } catch {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }
}

@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private let runtime: FIARuntime
    private let manifest: RuntimeManifest
    private let headless: Bool
    private var statusItem: NSStatusItem?
    private var stopping = false
    private var menuInstalled = false

    init(runtime: FIARuntime, manifest: RuntimeManifest, headless: Bool) {
        self.runtime = runtime
        self.manifest = manifest
        self.headless = headless
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if !headless {
            installMenu()
            installStatusItem()
        }
        Task { @MainActor in
            do {
                try await runtime.start()
                if !headless, manifest.app.activationPolicy == "regular" { NSApp.activate(ignoringOtherApps: true) }
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        runtime.lastWindowClosedAction == .quit
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !stopping else { return .terminateLater }
        stopping = true
        Task { @MainActor in
            let report = await runtime.stop()
            sender.reply(toApplicationShouldTerminate: report.completed)
            if !report.completed {
                stopping = false
                NSAlert(error: ManagedProcessError(report.issues.map(\.message).joined(separator: "\n"))).runModal()
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
        if runtime.updater.isEnabled, manifest.updater?.ui == "native" {
            applicationMenu.addItem(.separator())
            let update = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
            update.target = self
            applicationMenu.addItem(update)
        }
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
        runtime.customizeApplicationMenu(main)
    }

    private func installStatusItem() {
        guard let configuration = manifest.statusItem else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: configuration.symbol, accessibilityDescription: configuration.tooltip)
        item.button?.toolTip = configuration.tooltip
        let menu = NSMenu()
        let show = NSMenuItem(title: "Show", action: #selector(showMainWindow), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        statusItem = item
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard runtime.lifecycle == .running, runtime.reopenAction == .restoreMainWindow else { return false }
        try? runtime.windows.restoreMainWindow()
        return false
    }

    @objc private func showMainWindow() { try? runtime.windows.restoreMainWindow() }
    @objc private func checkForUpdates() { try? runtime.updater.checkForUpdates() }
}
