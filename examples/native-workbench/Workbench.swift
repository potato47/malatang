import AppKit
import FIA
import WebKit

@main
@MainActor
enum WorkbenchApp {
    static func main() {
        FIAApplication.run { runtime in
            let workbench = Workbench()
            runtime.windows.registerAppKit("main", userCloseAction: .hideApplication) { workbench.window }
            let cli = ManagedProcess(
                executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "printf 'ready\\n'; read command"])
            try runtime.startProcess(cli)
            runtime.onShutdown(name: "Workbench CLI") {
                if ProcessInfo.processInfo.environment["FIA_WORKBENCH_READY"] != nil {
                    try? FileHandle.standardError.write(contentsOf: Data("smoke: cleanup started\n".utf8))
                }
                try await cli.stop { try? cli.write(Data("quit\n".utf8)) }
                if ProcessInfo.processInfo.environment["FIA_WORKBENCH_READY"] != nil {
                    try? FileHandle.standardError.write(contentsOf: Data("smoke: CLI stopped\n".utf8))
                }
            }
            runtime.customizeMenu { menu in
                guard let file = menu.items.first(where: { $0.title == "File" })?.submenu else { return }
                let next = file.addItem(withTitle: "Next Tab", action: #selector(Workbench.nextTab), keyEquivalent: "t")
                next.target = workbench
            }
            if let ready = ProcessInfo.processInfo.environment["FIA_WORKBENCH_READY"] {
                Task { @MainActor in
                    while runtime.lifecycle == .running {
                        if (try? runtime.windows.state("main").lifecycle) == .open,
                            String(data: cli.stdout, encoding: .utf8)?.contains("ready") == true
                        {
                            if let token = ProcessInfo.processInfo.environment["FIA_WORKBENCH_COOKIE"] {
                                let restored = ProcessInfo.processInfo.environment["FIA_WORKBENCH_RESTORE"] == "1"
                                guard await workbench.verifyCookies(token: token, restoring: restored) else {
                                    try Data("Cookie persistence/isolation failed".utf8).write(
                                        to: URL(fileURLWithPath: ready + ".error"))
                                    FIAApplication.requestQuit()
                                    return
                                }
                            }
                            let data = try JSONEncoder().encode([
                                "appPID": ProcessInfo.processInfo.processIdentifier,
                                "servicePID": cli.processIdentifier,
                            ])
                            try data.write(to: URL(fileURLWithPath: ready), options: .atomic)
                            break
                        }
                        try await Task.sleep(for: .milliseconds(20))
                    }
                    while runtime.lifecycle == .running {
                        if FileManager.default.fileExists(atPath: ready + ".quit") {
                            try? FileHandle.standardError.write(contentsOf: Data("smoke: requesting Quit\n".utf8))
                            FIAApplication.requestQuit()
                            return
                        }
                        try await Task.sleep(for: .milliseconds(20))
                    }
                }
            }
        }
    }
}

/// Reference code: standard window buttons stay in AppKit's titlebar throughout fullscreen.
@MainActor
final class Workbench: NSObject {
    let window: NSWindow
    private let pages: [ExternalWebContent]
    private let tabs = NSSegmentedControl(
        labels: ["Workspace A", "Workspace B"], trackingMode: .selectOne, target: nil, action: nil)
    private var selected = 0
    private var dark = false

    override init() {
        pages = [
            ExternalWebContent(
                url: URL(string: "about:blank")!,
                dataStore: .persistent(UUID(uuidString: "19AA396C-D70C-4C63-8B1A-E92F397AB80F")!)),
            ExternalWebContent(
                url: URL(string: "about:blank")!,
                dataStore: .persistent(UUID(uuidString: "B7953788-88B8-4115-A043-C139014529F9")!)),
        ]
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        window.title = "FIA Native Workbench"
        window.center()
        tabs.selectedSegment = 0
        tabs.target = self
        tabs.action = #selector(selectTab)
        let theme = NSButton(title: "Toggle Theme", target: self, action: #selector(toggleTheme))
        let toolbar = NSStackView(views: [tabs, theme])
        toolbar.orientation = .horizontal
        toolbar.spacing = 16
        toolbar.edgeInsets = NSEdgeInsets(top: 6, left: 16, bottom: 6, right: 16)
        toolbar.setFrameSize(NSSize(width: 500, height: 40))
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .bottom
        accessory.view = toolbar
        accessory.fullScreenMinHeight = 40
        window.addTitlebarAccessoryViewController(accessory)
        let container = NSView()
        window.contentView = container
        for (index, page) in pages.enumerated() {
            let view = page.webView
            view.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                view.topAnchor.constraint(equalTo: container.topAnchor),
                view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])
            view.isHidden = index != 0
            page.onExternalLink = { url in
                if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            }
            page.downloadDestination = { response, filename in
                let panel = NSSavePanel()
                panel.nameFieldStringValue = filename
                return panel.runModal() == .OK ? panel.url : nil
            }
            page.webView.loadHTMLString(
                """
                <!doctype html><meta name="color-scheme" content="light dark">
                <style>body{font:17px system-ui;padding:40px;max-width:680px}input{font:inherit;padding:10px;width:90%}p{line-height:1.6}</style>
                <h1>Workspace \(index == 0 ? "A" : "B")</h1>
                <p>Type here, switch tabs, hide the app, then restore it from the Dock. Each workspace owns a persistent website data store.</p>
                <input placeholder="Input stays with this WebView">
                <p><a href="https://example.com">Navigate to example.com</a></p>
                """, baseURL: nil)
        }
    }

    func verifyCookies(token: String, restoring: Bool) async -> Bool {
        let store = pages[0].webView.configuration.websiteDataStore.httpCookieStore
        let cookie = HTTPCookie(properties: [
            .domain: "fia.example", .path: "/", .name: "fia-smoke", .value: token,
            .expires: Date().addingTimeInterval(3600),
        ])!
        if !restoring {
            await withCheckedContinuation { done in store.setCookie(cookie) { done.resume() } }
        }
        let first = await withCheckedContinuation { done in store.getAllCookies { done.resume(returning: $0) } }
        let other = await withCheckedContinuation { done in
            pages[1].webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { done.resume(returning: $0) }
        }
        let verified =
            first.contains { $0.name == "fia-smoke" && $0.value == token }
            && !other.contains { $0.name == "fia-smoke" && $0.value == token }
        if restoring {
            await withCheckedContinuation { done in store.delete(cookie) { done.resume() } }
        }
        return verified
    }

    @objc private func selectTab() {
        selected = tabs.selectedSegment
        for (index, page) in pages.enumerated() { page.webView.isHidden = index != selected }
    }
    @objc func nextTab() {
        tabs.selectedSegment = (selected + 1) % pages.count
        selectTab()
    }
    @objc private func toggleTheme() {
        dark.toggle()
        NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    }
}
