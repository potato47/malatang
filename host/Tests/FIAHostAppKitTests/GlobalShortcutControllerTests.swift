import FIAHostCore
import Testing
@testable import FIAHostAppKit

@MainActor
private final class MockGlobalShortcutRegistrar: GlobalShortcutRegistrar {
    var onPressed: ((UInt32) -> Void)?
    var registered: [NativeGlobalShortcut] = []
    var failure: HostRequestExecutionError?
    var replacements = 0

    func replace(with shortcuts: [NativeGlobalShortcut]) throws {
        replacements += 1
        if let failure { throw failure }
        registered = shortcuts
    }

    func clear() { registered = [] }
}

@MainActor
@Suite("Global shortcuts")
struct GlobalShortcutControllerTests {
    @Test func atomicallySetsAndEmitsShortcutIDs() throws {
        let registrar = MockGlobalShortcutRegistrar()
        let controller = GlobalShortcutController(registrar: registrar)
        var events: [String] = []
        controller.onEvent = { payload in
            if let id = payload["id"] as? String { events.append(id) }
        }
        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
            ["id": "search", "key": "space", "modifiers": ["option"]],
            ["id": "capture", "key": "4", "modifiers": ["control", "shift"]],
        ]])
        #expect(registrar.registered.count == 2)
        #expect(Set(registrar.registered.map(\.token)).count == 2)
        let captureToken = registrar.registered[1].token
        registrar.onPressed?(captureToken)
        #expect(events == ["capture"])

        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": []])
        #expect(registrar.registered.isEmpty)
        registrar.onPressed?(captureToken)
        #expect(events == ["capture"])
    }

    @Test func rejectsInvalidIDsKeysModifiersAndDuplicates() {
        let controller = GlobalShortcutController(registrar: MockGlobalShortcutRegistrar())
        for shortcuts in [
            [["id": "fia.reserved", "key": "a", "modifiers": ["command"]]],
            [["id": "bad", "key": "/", "modifiers": ["command"]]],
            [["id": "bad", "key": "a", "modifiers": []]],
            [
                ["id": "first", "key": "a", "modifiers": ["command"]],
                ["id": "second", "key": "A", "modifiers": ["command"]],
            ],
        ] as [[[String: Any]]] {
            #expect(throws: HostRequestExecutionError.self) {
                try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": shortcuts])
            }
        }
    }

    @Test func preservesPublishedIDsWhenNativeReplacementFails() throws {
        let registrar = MockGlobalShortcutRegistrar()
        let controller = GlobalShortcutController(registrar: registrar)
        var events: [String] = []
        controller.onEvent = { if let id = $0["id"] as? String { events.append(id) } }
        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
            ["id": "old", "key": "a", "modifiers": ["command"]],
        ]])
        let oldToken = registrar.registered[0].token
        registrar.failure = HostRequestExecutionError(code: .conflict, message: "busy")
        #expect(throws: HostRequestExecutionError.self) {
            try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
                ["id": "new", "key": "b", "modifiers": ["command"]],
            ]])
        }
        registrar.onPressed?(oldToken)
        #expect(events == ["old"])
    }

    @Test func clearRemovesNativeAndPublishedState() throws {
        let registrar = MockGlobalShortcutRegistrar()
        let controller = GlobalShortcutController(registrar: registrar)
        var emitted = false
        controller.onEvent = { _ in emitted = true }
        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
            ["id": "search", "key": "space", "modifiers": ["option"]],
        ]])
        let token = registrar.registered[0].token
        controller.clear()
        #expect(registrar.registered.isEmpty)
        registrar.onPressed?(token)
        #expect(!emitted)
    }

    @Test func keepsTokensStableWhenIDsAndOrderingChange() throws {
        let registrar = MockGlobalShortcutRegistrar()
        let controller = GlobalShortcutController(registrar: registrar)
        var events: [String] = []
        controller.onEvent = { if let id = $0["id"] as? String { events.append(id) } }
        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
            ["id": "first", "key": "a", "modifiers": ["command"]],
            ["id": "second", "key": "b", "modifiers": ["option"]],
        ]])
        let tokens = Dictionary(uniqueKeysWithValues: registrar.registered.map { ($0.keyCode, $0.token) })

        _ = try controller.execute(method: "globalShortcuts.set", params: ["shortcuts": [
            ["id": "renamed-second", "key": "b", "modifiers": ["option"]],
            ["id": "renamed-first", "key": "a", "modifiers": ["command"]],
        ]])
        #expect(Dictionary(uniqueKeysWithValues: registrar.registered.map { ($0.keyCode, $0.token) }) == tokens)
        registrar.onPressed?(registrar.registered[0].token)
        #expect(events == ["renamed-second"])
    }
}
