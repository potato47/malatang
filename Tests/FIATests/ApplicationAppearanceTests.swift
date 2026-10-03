import AppKit
import FIACore
import Testing

@testable import FIA

@MainActor @Suite("Application appearance", .serialized)
struct ApplicationAppearanceTests {
  @Test func switchesNativeAppearanceAndRestoresSystemWithoutChangingOSPreferences() async throws {
    let application = NSApplication.shared
    let original = application.appearance
    defer { application.appearance = original }
    let registry = NativeMethodRegistry()
    registry.setPermissions(["application": true])
    ApplicationAppearance.registerNativeMethods(registry)
    for (mode, name) in [("dark", NSAppearance.Name.darkAqua), ("light", NSAppearance.Name.aqua)] {
      let result = await registry.dispatch(
        method: "application.setAppearance", params: Data("{\"mode\":\"\(mode)\"}".utf8))
      guard case .success = result else { Issue.record("Appearance call failed: \(result)"); return }
      #expect(application.appearance?.name == name)
    }
    let invalid = await registry.dispatch(
      method: "application.setAppearance", params: Data("{\"mode\":\"sepia\"}".utf8))
    guard case .failure = invalid else { Issue.record("Invalid appearance was accepted"); return }
    #expect(application.appearance?.name == .aqua)
    let result = await registry.dispatch(
      method: "application.setAppearance", params: Data("{\"mode\":\"system\"}".utf8))
    guard case .success = result else { Issue.record("System reset failed"); return }
    #expect(application.appearance == nil)
  }
}
