import Carbon
import FIAHostCore
import Foundation

struct NativeGlobalShortcut: Equatable, Hashable, Sendable {
    let token: UInt32
    let keyCode: UInt32
    let modifiers: UInt32
}

@MainActor
protocol GlobalShortcutRegistrar: AnyObject {
    var onPressed: ((UInt32) -> Void)? { get set }
    func replace(with shortcuts: [NativeGlobalShortcut]) throws
    func clear()
}

@MainActor
final class CarbonGlobalShortcutRegistrar: GlobalShortcutRegistrar {
    var onPressed: ((UInt32) -> Void)?

    private let signature: OSType = 0x4649_4148 // FIAH
    private var eventHandler: EventHandlerRef?
    private var definitions: [UInt32: NativeGlobalShortcut] = [:]
    private var registrations: [UInt32: EventHotKeyRef] = [:]

    func replace(with shortcuts: [NativeGlobalShortcut]) throws {
        let requested = Dictionary(uniqueKeysWithValues: shortcuts.map { ($0.token, $0) })
        let additions = shortcuts.filter { definitions[$0.token] == nil }
        var added: [UInt32: EventHotKeyRef] = [:]
        do {
            if !additions.isEmpty { try ensureEventHandler() }
            for shortcut in additions {
                added[shortcut.token] = try register(shortcut)
            }
        } catch {
            added.values.forEach { UnregisterEventHotKey($0) }
            throw error
        }

        // Carbon does not provide a transactional replace operation. Register every
        // addition while the previous set is still live, then retire removals only
        // after all additions succeeded. A conflict therefore cannot create a gap
        // where another process steals one of the previously registered shortcuts.
        for token in definitions.keys where requested[token] == nil {
            if let registration = registrations.removeValue(forKey: token) {
                UnregisterEventHotKey(registration)
            }
        }
        registrations.merge(added) { _, new in new }
        definitions = requested
    }

    func clear() {
        unregisterAll()
        definitions.removeAll(keepingCapacity: false)
    }

    fileprivate func pressed(token: UInt32) { onPressed?(token) }

    private func ensureEventHandler() throws {
        guard eventHandler == nil else { return }
        var type = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            carbonGlobalShortcutHandler,
            1,
            &type,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
        guard status == noErr else {
            throw HostRequestExecutionError(
                code: .nativeFailure,
                message: "macOS could not install the global shortcut event handler (\(status))"
            )
        }
    }

    private func register(_ shortcut: NativeGlobalShortcut) throws -> EventHotKeyRef {
        var reference: EventHotKeyRef?
        let status = RegisterEventHotKey(
            shortcut.keyCode,
            shortcut.modifiers,
            EventHotKeyID(signature: signature, id: shortcut.token),
            GetApplicationEventTarget(),
            0,
            &reference
        )
        guard status == noErr, let reference else {
            throw HostRequestExecutionError(
                code: .conflict,
                message: "global shortcut is unavailable (\(status))"
            )
        }
        return reference
    }

    private func unregisterAll() {
        registrations.values.forEach { UnregisterEventHotKey($0) }
        registrations.removeAll(keepingCapacity: false)
    }

}

private let carbonGlobalShortcutHandler: EventHandlerUPP = { _, event, userData in
    guard let event, let userData else { return OSStatus(eventNotHandledErr) }
    var identifier = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &identifier
    )
    guard status == noErr else { return status }
    let address = UInt(bitPattern: userData)
    MainActor.assumeIsolated {
        guard let pointer = UnsafeMutableRawPointer(bitPattern: address) else { return }
        let registrar = Unmanaged<CarbonGlobalShortcutRegistrar>.fromOpaque(pointer).takeUnretainedValue()
        registrar.pressed(token: identifier.id)
    }
    return noErr
}

@MainActor
final class GlobalShortcutController {
    var onEvent: (([String: Any]) -> Void)?

    private let registrar: GlobalShortcutRegistrar
    private var idsByToken: [UInt32: String] = [:]

    init(registrar: GlobalShortcutRegistrar = CarbonGlobalShortcutRegistrar()) {
        self.registrar = registrar
        registrar.onPressed = { [weak self] token in self?.pressed(token) }
    }

    func execute(method: String, params: [String: Any]) throws -> Any? {
        guard method == "globalShortcuts.set" else {
            throw HostRequestExecutionError(code: .invalidRequest, message: "unknown global shortcut method: \(method)")
        }
        guard Set(params.keys) == ["shortcuts"], let values = params["shortcuts"] as? [[String: Any]] else {
            throw invalid("globalShortcuts.set requires a shortcuts array")
        }
        let parsed = try parse(values)
        try registrar.replace(with: parsed.shortcuts)
        idsByToken = parsed.idsByToken
        return nil
    }

    func clear() {
        registrar.clear()
        idsByToken.removeAll(keepingCapacity: false)
    }

    private func pressed(_ token: UInt32) {
        guard let id = idsByToken[token] else { return }
        onEvent?(["id": id])
    }

    private func parse(_ values: [[String: Any]]) throws -> (
        shortcuts: [NativeGlobalShortcut],
        idsByToken: [UInt32: String]
    ) {
        guard values.count <= 32 else { throw invalid("global shortcuts exceed 32 items") }
        var ids = Set<String>()
        var combinations = Set<String>()
        var shortcuts: [NativeGlobalShortcut] = []
        var idsByToken: [UInt32: String] = [:]
        for (index, value) in values.enumerated() {
            guard Set(value.keys) == ["id", "key", "modifiers"],
                  let id = value["id"] as? String,
                  let key = value["key"] as? String,
                  let modifiers = value["modifiers"] as? [String] else {
                throw invalid("global shortcut \(index) must contain id, key, and modifiers")
            }
            guard id.count <= 128,
                  !id.hasPrefix("fia."),
                  id.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil else {
                throw invalid("invalid or reserved global shortcut ID: \(id)")
            }
            guard ids.insert(id).inserted else { throw invalid("duplicate global shortcut ID: \(id)") }
            let keyCode = try Self.keyCode(key)
            let modifierMask = try Self.modifierMask(modifiers)
            let combination = "\(keyCode):\(modifierMask)"
            guard combinations.insert(combination).inserted else {
                throw invalid("duplicate global shortcut combination")
            }
            let token = Self.stableToken(keyCode: keyCode, modifierMask: modifierMask)
            shortcuts.append(.init(token: token, keyCode: keyCode, modifiers: modifierMask))
            idsByToken[token] = id
        }
        return (shortcuts, idsByToken)
    }

    private static func modifierMask(_ values: [String]) throws -> UInt32 {
        guard !values.isEmpty, Set(values).count == values.count else {
            throw HostRequestExecutionError(
                code: .invalidArgument,
                message: "global shortcut modifiers must be non-empty and unique"
            )
        }
        var result: UInt32 = 0
        for value in values {
            switch value {
            case "command": result |= UInt32(cmdKey)
            case "option": result |= UInt32(optionKey)
            case "control": result |= UInt32(controlKey)
            case "shift": result |= UInt32(shiftKey)
            default:
                throw HostRequestExecutionError(
                    code: .invalidArgument,
                    message: "invalid global shortcut modifier: \(value)"
                )
            }
        }
        return result
    }

    private static func stableToken(keyCode: UInt32, modifierMask: UInt32) -> UInt32 {
        var bits: UInt32 = 0
        if modifierMask & UInt32(cmdKey) != 0 { bits |= 1 << 0 }
        if modifierMask & UInt32(optionKey) != 0 { bits |= 1 << 1 }
        if modifierMask & UInt32(controlKey) != 0 { bits |= 1 << 2 }
        if modifierMask & UInt32(shiftKey) != 0 { bits |= 1 << 3 }
        // Carbon virtual key codes fit in one byte. Adding one reserves token 0
        // and makes the token stable for a physical key/modifier combination.
        return (bits << 8) | (keyCode + 1)
    }

    private static func keyCode(_ value: String) throws -> UInt32 {
        let key = value.lowercased()
        let named: [String: Int] = [
            "space": kVK_Space, "return": kVK_Return, "tab": kVK_Tab, "escape": kVK_Escape,
            "left": kVK_LeftArrow, "right": kVK_RightArrow, "up": kVK_UpArrow, "down": kVK_DownArrow,
            "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5,
            "f6": kVK_F6, "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10,
            "f11": kVK_F11, "f12": kVK_F12, "f13": kVK_F13, "f14": kVK_F14, "f15": kVK_F15,
            "f16": kVK_F16, "f17": kVK_F17, "f18": kVK_F18, "f19": kVK_F19, "f20": kVK_F20,
        ]
        if let code = named[key] { return UInt32(code) }
        let characters: [Character: Int] = [
            "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D,
            "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H,
            "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
            "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P,
            "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
            "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
            "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
            "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
            "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7,
            "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        ]
        if key.count == 1, let character = key.first, let code = characters[character] { return UInt32(code) }
        throw HostRequestExecutionError(code: .invalidArgument, message: "unsupported global shortcut key: \(value)")
    }

    private func invalid(_ message: String) -> HostRequestExecutionError {
        HostRequestExecutionError(code: .invalidArgument, message: message)
    }
}
