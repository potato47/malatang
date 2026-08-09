import FIAHostCore
import Foundation
import Testing

@Suite("Host settings")
struct HostSettingsTests {
    @Test func roundTripsWindowFramesAndVisibility() throws {
        let frame = DesktopWindowFrame(x: 50, y: 80, width: 900, height: 640)
        let settings = HostSettings(
            dockVisible: false,
            statusItemVisible: true,
            statusItemSymbol: "star.fill",
            windowFrames: ["main": frame]
        )
        let decoded = try HostSettings.decode(JSONEncoder().encode(settings))
        #expect(decoded.windowFrames["main"] == frame)
        #expect(decoded.statusItemSymbol == "star.fill")
    }

    @Test func rejectsUnsafeOrInvalidSettings() {
        let unsafe = #"{"schemaVersion":2,"dockVisible":false,"statusItemVisible":false,"statusItemSymbol":"bolt.fill","windowFrames":{}}"#.data(using: .utf8)!
        let badFrame = #"{"schemaVersion":2,"dockVisible":false,"statusItemVisible":true,"statusItemSymbol":"bolt.fill","windowFrames":{"main":{"x":0,"y":0,"width":0,"height":100}}}"#.data(using: .utf8)!
        #expect(throws: HostSettingsError.self) { try HostSettings.decode(unsafe) }
        #expect(throws: HostSettingsError.self) { try HostSettings.decode(badFrame) }
    }
}
