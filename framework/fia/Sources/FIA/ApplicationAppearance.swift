import AppKit
import FIACore

/// App-local appearance only. Choosing system removes the override; no macOS preference is changed.
@MainActor
enum ApplicationAppearance {
  static func registerNativeMethods(_ registry: NativeMethodRegistry) {
    registry.register(
      "application.setAppearance", input: BuiltinApplicationAppearance.self,
      output: FIAEmpty.self, permission: "application"
    ) { input in
      await MainActor.run {
        switch input.mode {
        case .system: NSApplication.shared.appearance = nil
        case .light: NSApplication.shared.appearance = NSAppearance(named: .aqua)
        case .dark: NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        }
        return FIAEmpty()
      }
    }
  }
}
