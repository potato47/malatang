import Foundation
import Testing
@testable import FIAHostCore

@Suite("Native bridge protocol")
struct NativeBridgeProtocolTests {
    private func request(_ command: String, params: [String: Any] = [:]) -> [String: Any] {
        ["version": 1, "command": command, "params": params]
    }

    @Test func parsesAllowlistedCommandsAndTypedArguments() throws {
        #expect(try NativeBridgeProtocol.parse(request("native.getState")) == .getState)
        #expect(try NativeBridgeProtocol.parse(request(
            "window.setAlwaysOnTop",
            params: ["enabled": true]
        )) == .setAlwaysOnTop(true))
        #expect(try NativeBridgeProtocol.parse(request(
            "statusBar.setIcon",
            params: ["symbol": "bolt.fill"]
        )) == .setStatusBarIcon("bolt.fill"))
    }

    @Test func rejectsUnknownFieldsCommandsAndArguments() {
        var extra = request("native.getState")
        extra["extra"] = true
        #expect(throws: NativeBridgeProtocolError.self) { try NativeBridgeProtocol.parse(extra) }
        #expect(throws: NativeBridgeProtocolError.self) {
            try NativeBridgeProtocol.parse(request("native.anything"))
        }
        #expect(throws: NativeBridgeProtocolError.self) {
            try NativeBridgeProtocol.parse(request("window.setAlwaysOnTop", params: ["enabled": "yes"]))
        }
        #expect(throws: NativeBridgeProtocolError.self) {
            try NativeBridgeProtocol.parse(request("statusBar.setIcon", params: ["symbol": " bad "]))
        }
    }

    @Test func rejectsRequestsOver64KiB() {
        #expect(throws: NativeBridgeProtocolError.self) {
            try NativeBridgeProtocol.parse(request(
                "statusBar.setIcon",
                params: ["symbol": String(repeating: "a", count: FIAMaximumNativeBridgeMessageBytes)]
            ))
        }
    }

    @Test func authorizesOnlyTheExactMainFrameOrigin() throws {
        let policy = try #require(NativeBridgeOriginPolicy(origin: URL(string: "http://127.0.0.1:49152")!))
        #expect(policy.allows(isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 49152))
        #expect(!policy.allows(isMainFrame: false, scheme: "http", host: "127.0.0.1", port: 49152))
        #expect(!policy.allows(isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 49153))
        #expect(!policy.allows(isMainFrame: true, scheme: "https", host: "127.0.0.1", port: 49152))
    }
}
