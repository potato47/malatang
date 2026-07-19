import AppKit
import FIAHostCore
import Foundation
import Testing
@testable import FIAHostAppKit

@MainActor
@Suite("AppKit desktop shell")
struct HostWindowControllerTests {
    private func configuration(closeBehavior: HostConfiguration.Window.CloseBehavior) -> HostConfiguration {
        HostConfiguration(
            schemaVersion: 3,
            protocolVersion: 1,
            app: .init(name: "Desktop", identifier: "com.example.desktop", mode: .hybrid),
            window: .init(
                width: 900,
                height: 600,
                minWidth: 500,
                minHeight: 400,
                closeBehavior: closeBehavior,
                restoreState: true,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            ),
            statusBar: .init(symbol: "bolt.fill", tooltip: "Desktop")
        )
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
        #expect(frame.width == 500)
        #expect(frame.height == 400)
    }

    @Test func rejectsFramesWithNoValidScreenSoConfiguredSizeCanBeCentered() {
        let restored = DesktopWindowFrame(x: 2000, y: 1400, width: 1800, height: 1000)
        #expect(HostWindowController.constrainedFrame(
            restored,
            minimumSize: NSSize(width: 500, height: 400),
            screens: [NSRect(x: 0, y: 0, width: 1440, height: 900)]
        ) == nil)
    }

    @Test func hideCloseBehaviorKeepsTheWindowControllerAlive() {
        _ = NSApplication.shared
        let controller = HostWindowController(configuration: configuration(closeBehavior: .hide))
        let shouldClose = controller.windowShouldClose(controller.window!)
        #expect(!shouldClose)
        #expect(controller.window != nil)
    }

    @Test func stateEventPayloadIncludesEffectiveMode() throws {
        let state = try DesktopState(
            dockVisible: true,
            statusBarVisible: true,
            statusBarSymbol: "bolt.fill",
            window: .init(
                visible: true,
                focused: false,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            )
        )
        let event = try NativeBridgeHandler.stateChangedEvent(state)
        let encodedState = try #require(event["state"] as? [String: Any])
        #expect(encodedState["mode"] as? String == "hybrid")
    }

    @Test func appliesWindowFlagsIndependently() throws {
        _ = NSApplication.shared
        let configuration = configuration(closeBehavior: .hide)
        let windowController = HostWindowController(configuration: configuration)
        let desktop = DesktopController(
            configuration: configuration,
            initialState: DesktopState(configuration: configuration),
            windowController: windowController,
            settingsStore: nil
        )
        desktop.start()
        _ = try desktop.execute(.setAlwaysOnTop(true))
        #expect(windowController.window?.level == .floating)
        #expect(windowController.window?.collectionBehavior.contains(.canJoinAllSpaces) == false)
        _ = try desktop.execute(.setVisibleOnAllSpaces(true))
        #expect(windowController.window?.collectionBehavior.contains(.canJoinAllSpaces) == true)
        #expect(windowController.window?.collectionBehavior.contains(.fullScreenAuxiliary) == false)
        _ = try desktop.execute(.setVisibleOverFullScreen(true))
        #expect(windowController.window?.collectionBehavior.contains(.canJoinAllSpaces) == true)
        #expect(windowController.window?.collectionBehavior.contains(.fullScreenAuxiliary) == true)
    }

    @Test func statusBarMenuTracksWindowVisibilityAndKeepsQuitAvailable() {
        let controller = StatusBarController(symbol: "bolt.fill", tooltip: "Desktop")

        controller.updateWindowVisible(true)
        let visibleMenu = controller.makeMenu()
        #expect(visibleMenu.items.map(\.title) == ["Hide Window", "", "Quit"])
        #expect(visibleMenu.items[0].isEnabled)
        #expect(visibleMenu.items[2].isEnabled)

        controller.updateWindowVisible(false)
        let hiddenMenu = controller.makeMenu()
        #expect(hiddenMenu.items.map(\.title) == ["Show Window", "", "Quit"])
        #expect(hiddenMenu.items[0].action != nil)
        #expect(hiddenMenu.items[2].action != nil)
    }
}
