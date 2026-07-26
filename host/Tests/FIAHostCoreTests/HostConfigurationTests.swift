import Foundation
import Testing
@testable import FIAHostCore

@Suite("Host configuration")
struct HostConfigurationTests {
    private let legacy = #"{"schemaVersion":1,"protocolVersion":1,"app":{"name":"FIA Prototype","identifier":"dev.fia.prototype","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480}}"#.data(using: .utf8)!

    private let current = #"{"schemaVersion":3,"protocolVersion":1,"app":{"name":"Desktop App","identifier":"com.example.desktop","mode":"hybrid"},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480,"closeBehavior":"hide","restoreState":true,"alwaysOnTop":true,"visibleOnAllSpaces":false,"visibleOverFullScreen":true},"statusBar":{"symbol":"bolt.fill","tooltip":"Desktop App"},"runtime":{"mode":"production"}}"#.data(using: .utf8)!

    @Test func decodesLegacyConfigurationWithCompatibleDefaults() throws {
        let configuration = try HostConfiguration.decode(legacy)
        #expect(configuration.schemaVersion == 1)
        #expect(configuration.app.mode == .dock)
        #expect(configuration.window.closeBehavior == .quit)
        #expect(configuration.window.restoreState == false)
        #expect(configuration.statusBar.symbol == "circle.grid.2x2.fill")
        #expect(configuration.runtime.mode == .production)
    }

    @Test func decodesSchemaTwoRuntimeModes() throws {
        let production = #"{"schemaVersion":2,"protocolVersion":1,"app":{"name":"Built App","identifier":"com.example.built","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480},"runtime":{"mode":"production"}}"#.data(using: .utf8)!
        let development = #"{"schemaVersion":2,"protocolVersion":1,"app":{"name":"Dev App","identifier":"com.example.dev","quitOnLastWindowClosed":false},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480},"runtime":{"mode":"development","executable":"/opt/homebrew/bin/bun","arguments":["--hot","/tmp/runtime-entry.ts"]}}"#.data(using: .utf8)!

        #expect(try HostConfiguration.decode(production).runtime.mode == .production)
        let dev = try HostConfiguration.decode(development)
        #expect(dev.runtime.isDevelopment)
        #expect(dev.window.closeBehavior == .hide)
        #expect(dev.runtime.arguments == ["--hot", "/tmp/runtime-entry.ts"])
    }

    @Test func decodesStrictSchemaThreeDesktopConfiguration() throws {
        let configuration = try HostConfiguration.decode(current)
        #expect(configuration.app.mode == .hybrid)
        #expect(configuration.window.closeBehavior == .hide)
        #expect(configuration.window.alwaysOnTop)
        #expect(configuration.window.visibleOverFullScreen)
        #expect(configuration.statusBar.symbol == "bolt.fill")
    }

    @Test func decodesBundledUIRuntime() throws {
        let bundled = current.replacing(
            #""runtime":{"mode":"production"}"#,
            with: #""runtime":{"mode":"bundled","entry":"UI/index.html"}"#
        )
        let configuration = try HostConfiguration.decode(bundled)
        #expect(configuration.runtime.isBundled)
        #expect(configuration.runtime.entry == "UI/index.html")

        let traversal = bundled.replacing("UI/index.html", with: "UI/../fia-config.json")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(traversal) }
        let outsideUI = bundled.replacing("UI/index.html", with: "index.html")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(outsideUI) }
    }

    @Test func decodesSchemaFourWithAnOrthogonalSwiftBackend() throws {
        let schemaFour = current
            .replacing(#""schemaVersion":3"#, with: #""schemaVersion":4"#)
            .replacing(
                #""runtime":{"mode":"production"}"#,
                with: #""runtime":{"mode":"bundled","entry":"UI/index.html"},"backend":{"mode":"production"}"#
            )
        let production = try HostConfiguration.decode(schemaFour)
        #expect(production.runtime.isBundled)
        #expect(production.backend.mode == .production)

        let development = schemaFour
            .replacing(
                #""runtime":{"mode":"bundled","entry":"UI/index.html"}"#,
                with: #""runtime":{"mode":"development","executable":"/usr/bin/bun","arguments":["--hot","entry.ts"]}"#
            )
            .replacing(#""backend":{"mode":"production"}"#, with: #""backend":{"mode":"development","executable":"/tmp/AppBackend"}"#)
        #expect(try HostConfiguration.decode(development).backend.isDevelopment)

        let invalid = schemaFour.replacing("UI/index.html", with: "../outside.html")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(invalid) }
    }

    @Test func decodesRuntimeOwnedBunBackend() throws {
        let configuration = current
            .replacing(#""schemaVersion":3"#, with: #""schemaVersion":4"#)
            .replacing(
                #""runtime":{"mode":"production"}"#,
                with: #""runtime":{"mode":"production"},"backend":{"mode":"runtime"}"#
            )
        let decoded = try HostConfiguration.decode(configuration)
        #expect(decoded.backend.usesRuntime)
        #expect(!decoded.backend.isEnabled)

        let invalid = configuration.replacing(
            #""runtime":{"mode":"production"}"#,
            with: #""runtime":{"mode":"bundled","entry":"UI/index.html"}"#
        )
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(invalid) }
    }

    @Test func rejectsInvalidRuntimeShapes() {
        let externalProduction = #"{"schemaVersion":2,"protocolVersion":1,"app":{"name":"Built App","identifier":"com.example.built","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480},"runtime":{"mode":"production","executable":"/tmp/bun"}}"#.data(using: .utf8)!
        let relativeDevelopment = #"{"schemaVersion":2,"protocolVersion":1,"app":{"name":"Dev App","identifier":"com.example.dev","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480},"runtime":{"mode":"development","executable":"bin/bun","arguments":["--hot"]}}"#.data(using: .utf8)!

        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(externalProduction) }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(relativeDevelopment) }
    }

    @Test func rejectsUnknownFieldsAtEverySchema() {
        let legacyExtra = legacy.replacing(#""schemaVersion":1"#, with: #""schemaVersion":1,"extra":true"#)
        let currentExtra = current.replacing(#""tooltip":"Desktop App""#, with: #""tooltip":"Desktop App","extra":true"#)
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(legacyExtra) }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(currentExtra) }
    }

    @Test func rejectsVersionsIdentifiersDimensionsAndStatusBar() {
        let wrongVersion = current.replacing(#""schemaVersion":3"#, with: #""schemaVersion":4"#)
        let wrongIdentifier = current.replacing("com.example.desktop", with: "invalid")
        let wrongDimensions = current.replacing(#""width":1024"#, with: #""width":100"#)
        let wrongSymbol = current.replacing("bolt.fill", with: " bad ")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongVersion) }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongIdentifier) }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongDimensions) }
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongSymbol) }
    }
}

private extension Data {
    func replacing(_ target: String, with replacement: String) -> Data {
        let value = String(decoding: self, as: UTF8.self).replacingOccurrences(of: target, with: replacement)
        return Data(value.utf8)
    }
}
