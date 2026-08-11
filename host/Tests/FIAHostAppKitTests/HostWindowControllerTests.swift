import AppKit
import FIAHostCore
import Foundation
import Testing
import WebKit
@testable import FIAHostAppKit

@MainActor
@Suite("AppKit host primitives")
struct HostWindowControllerTests {
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
