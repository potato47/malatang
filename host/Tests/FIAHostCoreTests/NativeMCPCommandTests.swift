import Testing
@testable import FIAHostCore

@Suite("Native MCP command parser")
struct NativeMCPCommandTests {
    @Test func parsesAllowlistedToolsAndTypedArguments() throws {
        #expect(try NativeMCPCommandParser.parse(
            command: "native.getState",
            arguments: [:]
        ) == .getState)
        #expect(try NativeMCPCommandParser.parse(
            command: "window.setAlwaysOnTop",
            arguments: ["enabled": true]
        ) == .setAlwaysOnTop(true))
        #expect(try NativeMCPCommandParser.parse(
            command: "statusBar.setIcon",
            arguments: ["symbol": "bolt.fill"]
        ) == .setStatusBarIcon("bolt.fill"))
    }

    @Test func rejectsUnknownToolsAndInvalidArguments() {
        #expect(throws: NativeMCPCommandError.self) {
            try NativeMCPCommandParser.parse(command: "native.anything", arguments: [:])
        }
        #expect(throws: NativeMCPCommandError.self) {
            try NativeMCPCommandParser.parse(
                command: "window.setAlwaysOnTop",
                arguments: ["enabled": "yes"]
            )
        }
        #expect(throws: NativeMCPCommandError.self) {
            try NativeMCPCommandParser.parse(
                command: "statusBar.setIcon",
                arguments: ["symbol": " bad "]
            )
        }
        #expect(throws: NativeMCPCommandError.self) {
            try NativeMCPCommandParser.parse(
                command: "native.getState",
                arguments: ["extra": true]
            )
        }
    }
}
