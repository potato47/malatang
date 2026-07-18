import Foundation
import Testing
@testable import FIAHostCore

@Suite("Host configuration")
struct HostConfigurationTests {
    private let valid = #"{"schemaVersion":1,"protocolVersion":1,"app":{"name":"FIA Prototype","identifier":"dev.fia.prototype","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480}}"#.data(using: .utf8)!

    @Test func decodesStrictConfiguration() throws {
        let configuration = try HostConfiguration.decode(valid)
        #expect(configuration.app.identifier == "dev.fia.prototype")
        #expect(configuration.window.width == 1024)
    }

    @Test func rejectsUnknownFields() {
        let data = #"{"schemaVersion":1,"protocolVersion":1,"extra":true,"app":{"name":"FIA Prototype","identifier":"dev.fia.prototype","quitOnLastWindowClosed":true},"window":{"width":1024,"height":700,"minWidth":720,"minHeight":480}}"#.data(using: .utf8)!
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(data) }
    }

    @Test func rejectsVersionsIdentifiersAndDimensions() {
        let wrongVersion = valid.replacing(#""schemaVersion":1"#, with: #""schemaVersion":2"#)
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongVersion) }

        let wrongIdentifier = valid.replacing("dev.fia.prototype", with: "invalid")
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongIdentifier) }

        let wrongDimensions = valid.replacing(#""width":1024"#, with: #""width":100"#)
        #expect(throws: HostConfigurationError.self) { try HostConfiguration.decode(wrongDimensions) }
    }
}

private extension Data {
    func replacing(_ target: String, with replacement: String) -> Data {
        let value = String(decoding: self, as: UTF8.self).replacingOccurrences(of: target, with: replacement)
        return Data(value.utf8)
    }
}

