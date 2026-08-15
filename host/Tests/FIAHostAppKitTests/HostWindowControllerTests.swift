import AppKit
import FIAHostCore
import Foundation
import Testing
import WebKit
@testable import FIAHostAppKit

@MainActor
private final class RecordingWindow: NSWindow {
    private(set) var madeKeyAndOrderedFront = false

    override func makeKeyAndOrderFront(_ sender: Any?) {
        madeKeyAndOrderedFront = true
    }
}

@MainActor
@Suite("AppKit host primitives")
struct HostWindowControllerTests {
    @Test func mainMenuProvidesStandardEditingCommands() throws {
        let menu = AppDelegate.makeMainMenu(applicationName: "Desktop")
        #expect(menu.items.count == 2)
        #expect(menu.items[0].submenu?.title == "Desktop")

        let editMenu = try #require(menu.items[1].submenu)
        #expect(editMenu.title == "Edit")
        #expect(editMenu.items.map(\.title) == ["Undo", "Redo", "", "Cut", "Copy", "Paste", "Select All"])

        let commands = editMenu.items.filter { !$0.isSeparatorItem }
        #expect(commands.map(\.action) == [
            Selector(("undo:")),
            Selector(("redo:")),
            #selector(NSText.cut(_:)),
            #selector(NSText.copy(_:)),
            #selector(NSText.paste(_:)),
            #selector(NSText.selectAll(_:)),
        ])
        #expect(commands.map(\.keyEquivalent) == ["z", "z", "x", "c", "v", "a"])
        #expect(commands.map(\.keyEquivalentModifierMask) == [
            [.command],
            [.command, .shift],
            [.command],
            [.command],
            [.command],
            [.command],
        ])
        #expect(commands.allSatisfy { $0.target == nil })
    }

    @Test func constrainsRestoredFramesToAVisibleScreen() throws {
        let screen = NSRect(x: 0, y: 0, width: 1440, height: 900)
        let restored = DesktopWindowFrame(x: 1200, y: 700, width: 500, height: 400)
        let frame = try #require(HostWindowController.constrainedFrame(
            restored,
            minimumSize: NSSize(width: 500, height: 400),
            screens: [screen]
        ))
        #expect(screen.contains(frame))
    }

    @Test func convertsFramesUsingPrimaryScreenTopLeftCoordinates() {
        let primary = NSRect(x: 0, y: 0, width: 1440, height: 900)
        let native = NSRect(x: -800, y: 900, width: 800, height: 600)
        let publicFrame = HostWindowController.publicFrame(native, primaryScreen: primary)
        #expect(publicFrame == NSRect(x: -800, y: -600, width: 800, height: 600))
        #expect(HostWindowController.positionedFrame(
            NSRect(x: 200, y: 100, width: 800, height: 600),
            x: publicFrame.origin.x,
            y: publicFrame.origin.y,
            primaryScreen: primary
        ) == native)

        let oneAxis = HostWindowController.positionedFrame(
            NSRect(x: 200, y: 100, width: 500, height: 300),
            x: nil,
            y: 40,
            primaryScreen: primary
        )
        #expect(oneAxis.origin == NSPoint(x: 200, y: 560))

        let intentionallyOffscreen = HostWindowController.positionedFrame(
            NSRect(x: 200, y: 100, width: 500, height: 300),
            x: -2_000,
            y: -400,
            primaryScreen: primary
        )
        #expect(intentionallyOffscreen.origin == NSPoint(x: -2_000, y: 1_000))
        #expect(HostWindowController.constrainedFrame(
            DesktopWindowFrame(x: -2_000, y: 1_000, width: 500, height: 300),
            minimumSize: NSSize(width: 320, height: 180),
            screens: [primary]
        ) == nil)
    }

    @Test func recognizesOnlyTheConfiguredTopDragStrip() {
        let bounds = NSRect(x: 0, y: 0, width: 600, height: 400)
        let region = HostWindowDragRegion(height: 32, leftInset: 12, rightInset: 48)
        #expect(FIAHostWindow.containsDragPoint(
            NSPoint(x: 20, y: 390),
            bounds: bounds,
            flipped: false,
            region: region
        ))
        #expect(!FIAHostWindow.containsDragPoint(
            NSPoint(x: 8, y: 390),
            bounds: bounds,
            flipped: false,
            region: region
        ))
        #expect(!FIAHostWindow.containsDragPoint(
            NSPoint(x: 580, y: 390),
            bounds: bounds,
            flipped: false,
            region: region
        ))
        #expect(!FIAHostWindow.containsDragPoint(
            NSPoint(x: 20, y: 350),
            bounds: bounds,
            flipped: false,
            region: region
        ))
        #expect(FIAHostWindow.containsDragPoint(
            NSPoint(x: 20, y: 10),
            bounds: bounds,
            flipped: true,
            region: region
        ))
    }

    @Test func hideCloseBehaviorKeepsWindowAlive() throws {
        _ = NSApplication.shared
        let controller = HostWindowController(
            id: "main",
            url: URL(string: "https://example.com")!,
            title: "Desktop",
            width: 900,
            height: 600,
            minWidth: 500,
            minHeight: 400,
            restoredFrame: nil,
            dataStore: .nonPersistent(),
            closeBehavior: .hide,
            alwaysOnTop: false,
            visibleOnAllSpaces: false,
            visibleOverFullScreen: false,
            inspectable: false
        )
        #expect(!controller.windowShouldClose(controller.window!))
        #expect(controller.window != nil)
        #expect(controller.window?.styleMask.contains(.titled) == true)
        #expect(controller.window?.styleMask.contains(.resizable) == true)
        #expect(controller.state()["windowStyle"] as? String == "native")
        #expect(controller.state()["transparent"] as? Bool == false)
        #expect(controller.state()["shadow"] as? Bool == true)
        #expect(controller.state()["resizable"] as? Bool == true)
        #expect(controller.state()["dragRegion"] is NSNull)
        #expect(controller.state()["frame"] is [String: Any])
    }

    @Test func bringingWindowToFrontMakesItKeyAndActivatesApplication() {
        let window = RecordingWindow()
        var activated = false

        HostWindowController.makeKeyAndActivate(window) { activated = true }

        #expect(window.madeKeyAndOrderedFront)
        #expect(activated)
    }

    @Test func configuresFocusableTransparentBorderlessWindows() throws {
        _ = NSApplication.shared
        let dragRegion = HostWindowDragRegion(height: 32, leftInset: 12, rightInset: 48)
        let controller = HostWindowController(
            id: "launcher",
            url: URL(string: "https://example.com")!,
            title: "Launcher",
            width: 640,
            height: 360,
            minWidth: 320,
            minHeight: 180,
            restoredFrame: nil,
            dataStore: .nonPersistent(),
            closeBehavior: .hide,
            windowStyle: .borderless,
            transparent: true,
            shadow: false,
            resizable: false,
            dragRegion: dragRegion,
            alwaysOnTop: true,
            visibleOnAllSpaces: true,
            visibleOverFullScreen: true,
            inspectable: false
        )
        let window = try #require(controller.window as? FIAHostWindow)
        let webView = try #require(window.contentView as? WKWebView)
        #expect(!window.styleMask.contains(.titled))
        #expect(!window.styleMask.contains(.resizable))
        #expect(window.canBecomeKey)
        #expect(window.canBecomeMain)
        #expect(!window.isOpaque)
        #expect(window.backgroundColor == .clear)
        #expect(!window.hasShadow)
        #expect(webView.underPageBackgroundColor.alphaComponent == 0)
        #expect(webView.value(forKey: "drawsBackground") as? Bool == false)
        #expect(window.dragRegion == dragRegion)

        let state = controller.state()
        #expect(state["windowStyle"] as? String == "borderless")
        #expect(state["transparent"] as? Bool == true)
        #expect(state["shadow"] as? Bool == false)
        #expect(state["resizable"] as? Bool == false)
        #expect((state["dragRegion"] as? [String: Any])?["height"] as? Double == 32)

        var changes = 0
        controller.onStateChanged = { changes += 1 }
        window.onDragEnded?()
        #expect(changes == 1)
        controller.windowDidEndLiveResize(Notification(name: NSWindow.didEndLiveResizeNotification))
        #expect(changes == 2)
    }

    @Test func rejectsChangesToCreationOnlyWindowOptions() throws {
        _ = NSApplication.shared
        let controller = HostWindowController(
            id: "immutable",
            url: URL(string: "https://example.com")!,
            title: "Immutable",
            width: 640,
            height: 360,
            minWidth: 320,
            minHeight: 180,
            restoredFrame: nil,
            dataStore: .nonPersistent(),
            closeBehavior: .hide,
            windowStyle: .borderless,
            transparent: true,
            shadow: true,
            resizable: false,
            alwaysOnTop: false,
            visibleOnAllSpaces: false,
            visibleOverFullScreen: false,
            inspectable: false
        )
        try controller.validateCreationOptions(
            windowStyle: .borderless,
            transparent: true,
            shadow: true,
            resizable: false,
            dragRegion: nil
        )
        #expect(throws: HostRequestExecutionError.self) {
            try controller.validateCreationOptions(
                windowStyle: .native,
                transparent: true,
                shadow: true,
                resizable: false,
                dragRegion: nil
            )
        }
    }

    @Test func coalescesFrameChangesAndFlushesInteractionEnd() async throws {
        _ = NSApplication.shared
        let controller = HostWindowController(
            id: "events",
            url: URL(string: "http://127.0.0.1:1")!,
            title: "Events",
            width: 640,
            height: 360,
            minWidth: 320,
            minHeight: 180,
            restoredFrame: nil,
            dataStore: .nonPersistent(),
            closeBehavior: .hide,
            alwaysOnTop: false,
            visibleOnAllSpaces: false,
            visibleOverFullScreen: false,
            inspectable: false
        )
        (controller.window?.contentView as? WKWebView)?.navigationDelegate = nil
        try await Task.sleep(for: .milliseconds(150))
        var changes = 0
        controller.onStateChanged = { changes += 1 }
        controller.windowDidMove(Notification(name: NSWindow.didMoveNotification))
        controller.windowDidMove(Notification(name: NSWindow.didMoveNotification))
        try await Task.sleep(for: .milliseconds(150))
        #expect(changes == 1)

        controller.windowDidResize(Notification(name: NSWindow.didResizeNotification))
        controller.windowDidEndLiveResize(Notification(name: NSWindow.didEndLiveResizeNotification))
        #expect(changes == 2)
        try await Task.sleep(for: .milliseconds(150))
        #expect(changes == 2)
    }

    @Test func registryRejectsInvalidAndMutableBorderlessOptions() throws {
        _ = NSApplication.shared
        let registry = WebViewRegistry(appName: "Desktop", inspectable: false, storedFrames: [:])
        #expect(throws: HostRequestExecutionError.self) {
            try registry.execute(method: "webviews.open", params: [
                "id": "invalid", "url": "https://example.com", "transparent": true,
            ])
        }

        _ = try registry.execute(method: "webviews.open", params: [
            "id": "main", "url": "https://example.com", "focus": false,
            "windowStyle": "borderless", "transparent": true, "shadow": false,
            "resizable": false, "x": -120, "y": 80,
            "dragRegion": ["height": 30, "leftInset": 8, "rightInset": 40],
        ])
        #expect(throws: HostRequestExecutionError.self) {
            try registry.execute(method: "webviews.open", params: [
                "id": "main", "url": "https://example.com", "windowStyle": "native",
            ])
        }
        #expect(throws: HostRequestExecutionError.self) {
            try registry.execute(method: "webviews.update", params: [
                "id": "main", "transparent": false,
            ])
        }
        let serialized = try JSONSerialization.data(withJSONObject: [
            "id": "zero-origin", "url": "https://example.com", "focus": false,
            "width": 900, "height": 600, "x": 0, "y": 1,
        ])
        let zeroOrigin = try #require(
            try JSONSerialization.jsonObject(with: serialized) as? [String: Any]
        )
        #expect((zeroOrigin["x"] as? NSNumber)?.isJSONBoolean == false)
        #expect((zeroOrigin["y"] as? NSNumber)?.isJSONBoolean == false)
        let opened = try #require(
            try registry.execute(method: "webviews.open", params: zeroOrigin) as? [String: Any]
        )
        let openedFrame = try #require(opened["frame"] as? [String: Any])
        #expect((openedFrame["x"] as? NSNumber)?.doubleValue == 0)
        _ = try registry.execute(method: "webviews.close", params: ["id": "zero-origin"])
        let updated = try #require(try registry.execute(method: "webviews.update", params: [
            "id": "main", "x": -80, "y": 60,
        ]) as? [String: Any])
        #expect(updated["frame"] is [String: Any])
        let windows = try #require(try registry.execute(method: "webviews.list", params: [:]) as? [[String: Any]])
        #expect(windows.count == 1)
        #expect(windows[0]["windowStyle"] as? String == "borderless")
        #expect(windows[0]["transparent"] as? Bool == true)
        _ = try registry.execute(method: "webviews.close", params: ["id": "main"])
    }

    @Test func buildsNestedDynamicMenuAndKeepsQuit() throws {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")
        try controller.setMenu([
            ["type": "item", "id": "open", "title": "Open", "symbol": "macwindow"],
            ["type": "item", "id": "mode", "title": "Mode", "children": [
                ["type": "item", "id": "mode.auto", "title": "Automatic", "checked": true],
            ]],
        ])
        let menu = controller.makeMenu()
        #expect(menu.items.map(\.title) == ["Open", "Mode", "", "Quit"])
        #expect(menu.items[1].submenu?.items.first?.state == .on)
        #expect(menu.items.last?.keyEquivalent == "q")
    }

    @Test func rejectsReservedAndDuplicateMenuIDs() {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")
        #expect(throws: HostRequestExecutionError.self) {
            try controller.setMenu([["type": "item", "id": "fia.bad", "title": "Bad"]])
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.setMenu([
                ["type": "item", "id": "same", "title": "One"],
                ["type": "item", "id": "same", "title": "Two"],
            ])
        }
    }

    @Test func reportsInvalidMenuSymbolsWithItemContext() {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")
        do {
            try controller.setMenu([
                ["type": "item", "id": "compose-note", "title": "Compose", "symbol": "fia.not-a-real-symbol"],
            ])
            Issue.record("Expected an invalid SF Symbol error")
        } catch let error as HostRequestExecutionError {
            #expect(error.message == #"invalid SF Symbol name "fia.not-a-real-symbol" on item "compose-note""#)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test func developmentActionsRequireAnActionableMenuLeaf() throws {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")
        var actions: [String] = []
        controller.onAction = { actions.append($0) }
        try controller.setMenu([
            ["type": "item", "id": "open", "title": "Open"],
            ["type": "item", "id": "disabled", "title": "Disabled", "enabled": false],
            ["type": "item", "id": "hidden", "title": "Hidden", "hidden": true],
            ["type": "item", "id": "parent", "title": "Parent", "children": [
                ["type": "item", "id": "child", "title": "Child"],
            ]],
            ["type": "item", "id": "disabled-parent", "title": "Disabled Parent", "enabled": false, "children": [
                ["type": "item", "id": "blocked-child", "title": "Blocked Child"],
            ]],
        ])

        try controller.emitActionForDevelopment(id: "open")
        try controller.emitActionForDevelopment(id: "child")
        #expect(actions == ["open", "child"])
        #expect(throws: HostRequestExecutionError.self) {
            try controller.emitActionForDevelopment(id: "missing")
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.emitActionForDevelopment(id: "disabled")
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.emitActionForDevelopment(id: "hidden")
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.emitActionForDevelopment(id: "parent")
        }
        #expect(throws: HostRequestExecutionError.self) {
            try controller.emitActionForDevelopment(id: "blocked-child")
        }
        #expect(actions == ["open", "child"])
    }

    @Test func menuUpdatesAreAtomicAndStartingClearsOnReady() throws {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")
        try controller.setMenu([["type": "item", "id": "open", "title": "Open"]])
        #expect(throws: HostRequestExecutionError.self) {
            try controller.updateMenuItem(id: "open", patch: ["title": 42])
        }
        #expect(controller.makeMenu().items.first?.title == "Open")

        controller.showStarting()
        controller.showReadyIfStarting()
        #expect(controller.makeMenu().items.map(\.title) == ["Quit"])
    }

    @Test func updatesWindowConfigurationAndCloseBehavior() throws {
        _ = NSApplication.shared
        let controller = HostWindowController(
            id: "settings",
            url: URL(string: "https://example.com")!,
            title: "Settings",
            width: 900,
            height: 600,
            minWidth: 500,
            minHeight: 400,
            restoredFrame: nil,
            dataStore: .nonPersistent(),
            closeBehavior: .hide,
            alwaysOnTop: false,
            visibleOnAllSpaces: false,
            visibleOverFullScreen: false,
            inspectable: false
        )
        try controller.update(
            title: "Updated",
            width: 840,
            height: 540,
            minWidth: 720,
            minHeight: 480,
            closeBehavior: .close,
            alwaysOnTop: true,
            visibleOnAllSpaces: true,
            visibleOverFullScreen: true
        )
        #expect(controller.state()["title"] as? String == "Updated")
        #expect(controller.state()["alwaysOnTop"] as? Bool == true)
        #expect(controller.windowShouldClose(controller.window!))
    }
}
