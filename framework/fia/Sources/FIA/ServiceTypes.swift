// Native service parameter types, shared with the TypeScript API.
import Foundation

public struct BuiltinApplicationInfo: Codable, Sendable {
  public let name: String
  public let identifier: String
  public let version: String
  public let build: Int

  public init(name: String, identifier: String, version: String, build: Int) {
    self.name = name
    self.identifier = identifier
    self.version = version
    self.build = build
  }
}

public struct BuiltinApplicationAppearance: Codable, Sendable {
  public enum Mode: String, Codable, Sendable {
    case system, light, dark
  }
  public let mode: Mode

  public init(mode: Mode) {
    self.mode = mode
  }
}

public struct BuiltinClipboardText: Codable, Sendable {
  public let text: String

  public init(text: String) {
    self.text = text
  }
}

public struct BuiltinOpenFilesInput: Codable, Sendable {
  public let multiple: Bool

  public init(multiple: Bool) {
    self.multiple = multiple
  }
}

public struct BuiltinSaveFileInput: Codable, Sendable {
  public let suggestedName: String?

  public init(suggestedName: String? = nil) {
    self.suggestedName = suggestedName
  }
}

public struct BuiltinKeyInput: Codable, Sendable {
  public let key: String

  public init(key: String) {
    self.key = key
  }
}

public struct BuiltinKeyValueInput: Codable, Sendable {
  public let key: String
  public let value: String

  public init(key: String, value: String) {
    self.key = key
    self.value = value
  }
}

public struct BuiltinNotificationInput: Codable, Sendable {
  public let title: String
  public let body: String

  public init(title: String, body: String) {
    self.title = title
    self.body = body
  }
}

public struct BuiltinURLInput: Codable, Sendable {
  public let url: String

  public init(url: String) {
    self.url = url
  }
}

public struct BuiltinPathInput: Codable, Sendable {
  public let path: String

  public init(path: String) {
    self.path = path
  }
}

public struct BuiltinResourceID: Codable, Sendable {
  public let id: String

  public init(id: String) {
    self.id = id
  }
}

public struct BuiltinWindowID: Codable, Sendable {
  public let id: String

  public init(id: String) {
    self.id = id
  }
}

public struct BuiltinWebWindowInput: Codable, Sendable {
  public let id: String
  public let route: String
  public let title: String

  public init(id: String, route: String, title: String) {
    self.id = id
    self.route = route
    self.title = title
  }
}

public struct BuiltinShortcut: Codable, Sendable {
  public let id: String
  public let key: String
  public let modifiers: [String]

  public init(id: String, key: String, modifiers: [String]) {
    self.id = id
    self.key = key
    self.modifiers = modifiers
  }
}

public struct BuiltinShortcutsInput: Codable, Sendable {
  public let shortcuts: [BuiltinShortcut]

  public init(shortcuts: [BuiltinShortcut]) {
    self.shortcuts = shortcuts
  }
}

public struct BuiltinResourceDescriptor: Codable, Sendable {
  public let id: String
  public let url: String
  public let contentType: String
  public let byteLength: Int
  public let expiresAt: String

  public init(id: String, url: String, contentType: String, byteLength: Int, expiresAt: String) {
    self.id = id
    self.url = url
    self.contentType = contentType
    self.byteLength = byteLength
    self.expiresAt = expiresAt
  }
}

public struct BuiltinWindowState: Codable, Sendable {
  public let id: String
  public let kind: String
  public let lifecycle: String
  public let orderedIn: Bool
  public let applicationHidden: Bool
  public let miniaturized: Bool
  public let focused: Bool
  public let fullscreen: String

  public init(
    id: String, kind: String, lifecycle: String, orderedIn: Bool, applicationHidden: Bool,
    miniaturized: Bool, focused: Bool, fullscreen: String
  ) {
    self.id = id
    self.kind = kind
    self.lifecycle = lifecycle
    self.orderedIn = orderedIn
    self.applicationHidden = applicationHidden
    self.miniaturized = miniaturized
    self.focused = focused
    self.fullscreen = fullscreen
  }
}

public struct BuiltinScreenDescriptor: Codable, Sendable {
  public let id: Int
  public let name: String
  public let frame: [[Double]]
  public let visibleFrame: [[Double]]
  public let scaleFactor: Double
  public let main: Bool

  public init(
    id: Int, name: String, frame: [[Double]], visibleFrame: [[Double]], scaleFactor: Double,
    main: Bool
  ) {
    self.id = id
    self.name = name
    self.frame = frame
    self.visibleFrame = visibleFrame
    self.scaleFactor = scaleFactor
    self.main = main
  }
}

public typealias BuiltinAPIErrorCode = String
