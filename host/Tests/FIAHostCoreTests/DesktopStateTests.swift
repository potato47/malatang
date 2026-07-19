import Foundation
import Testing
@testable import FIAHostCore

@Suite("Desktop state and settings")
struct DesktopStateTests {
    private func configuration(mode: HostConfiguration.App.Mode = .dock) -> HostConfiguration {
        HostConfiguration(
            schemaVersion: 3,
            protocolVersion: 1,
            app: .init(name: "Desktop", identifier: "com.example.desktop", mode: mode),
            window: .init(
                width: 1000,
                height: 700,
                minWidth: 600,
                minHeight: 400,
                closeBehavior: mode == .dock ? .quit : .hide,
                restoreState: true,
                alwaysOnTop: false,
                visibleOnAllSpaces: false,
                visibleOverFullScreen: false
            ),
            statusBar: .init(symbol: "bolt.fill", tooltip: "Desktop")
        )
    }

    @Test func derivesInitialAndEffectiveModes() throws {
        #expect(DesktopState(configuration: configuration()).mode == .dock)
        #expect(DesktopState(configuration: configuration(mode: .statusBar)).mode == .statusBar)
        var state = DesktopState(configuration: configuration(mode: .hybrid))
        #expect(state.mode == .hybrid)
        try state.setStatusBarVisible(false)
        #expect(state.mode == .dock)
    }

    @Test func preservesAtLeastOneRecoveryEntry() throws {
        var dock = DesktopState(configuration: configuration())
        #expect(throws: DesktopStateError.self) { try dock.setDockVisible(false) }
        try dock.setStatusBarVisible(true)
        try dock.setDockVisible(false)
        #expect(dock.mode == .statusBar)
        #expect(throws: DesktopStateError.self) { try dock.setStatusBarVisible(false) }
    }

    @Test func roundTripsValidatedSettingsAndAppliesOverrides() throws {
        var state = DesktopState(configuration: configuration())
        try state.setStatusBarVisible(true)
        try state.setDockVisible(false)
        state.statusBarSymbol = "star.fill"
        state.window.alwaysOnTop = true
        let frame = DesktopWindowFrame(x: 50, y: 80, width: 900, height: 640)
        let encoded = try JSONEncoder().encode(DesktopSettings(state: state, windowFrame: frame))
        let decoded = try DesktopSettings.decode(encoded)
        let applied = try decoded.applying(to: DesktopState(configuration: configuration()))
        #expect(applied.mode == .statusBar)
        #expect(applied.statusBarSymbol == "star.fill")
        #expect(applied.window.alwaysOnTop)
        #expect(decoded.windowFrame == frame)
    }

    @Test func rejectsCorruptUnknownAndUnsafeSettings() {
        let unknown = #"{"schemaVersion":1,"dockVisible":true,"statusBarVisible":false,"statusBarSymbol":"bolt.fill","alwaysOnTop":false,"visibleOnAllSpaces":false,"visibleOverFullScreen":false,"extra":true}"#.data(using: .utf8)!
        let unsafe = #"{"schemaVersion":1,"dockVisible":false,"statusBarVisible":false,"statusBarSymbol":"bolt.fill","alwaysOnTop":false,"visibleOnAllSpaces":false,"visibleOverFullScreen":false}"#.data(using: .utf8)!
        let badFrame = #"{"schemaVersion":1,"dockVisible":true,"statusBarVisible":false,"statusBarSymbol":"bolt.fill","alwaysOnTop":false,"visibleOnAllSpaces":false,"visibleOverFullScreen":false,"windowFrame":{"x":0,"y":0,"width":0,"height":100}}"#.data(using: .utf8)!
        #expect(throws: DesktopSettingsError.self) { try DesktopSettings.decode(unknown) }
        #expect(throws: DesktopSettingsError.self) { try DesktopSettings.decode(unsafe) }
        #expect(throws: DesktopSettingsError.self) { try DesktopSettings.decode(badFrame) }
    }
}
