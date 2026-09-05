@testable import FIA
import AppKit
import XCTest

@MainActor
final class ApplicationExtensionTests: XCTestCase {
    func testShutdownHandlersAreAwaitedOnceAcrossUpdateAndQuit() async throws {
        let runtime = try FIARuntime(manifest: RuntimeManifest.load())
        var calls: [Int] = []
        runtime.onShutdown { calls.append(1) }
        runtime.onShutdown {
            try? await Task.sleep(for: .milliseconds(30))
            calls.append(2)
        }
        let first = Task { await runtime.prepareForUpdate() }
        let second = Task { await runtime.stop() }
        await first.value
        await second.value
        XCTAssertEqual(calls, [2, 1])
        await runtime.runShutdownHandlers()
        XCTAssertEqual(calls, [2, 1])
    }

    func testMenuCustomizationCanReplaceDefaultShortcut() throws {
        let runtime = try FIARuntime(manifest: RuntimeManifest.load())
        let menu = NSMenu()
        let file = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        file.submenu = NSMenu(title: "File")
        file.submenu?.addItem(withTitle: "Close Window", action: nil, keyEquivalent: "w")
        menu.addItem(file)
        runtime.customizeMenu { main in
            let file = main.items[0].submenu!
            file.removeAllItems()
            file.addItem(withTitle: "Close Tab", action: nil, keyEquivalent: "w")
        }
        runtime.customizeApplicationMenu(menu)
        XCTAssertEqual(file.submenu?.items.count, 1)
        XCTAssertEqual(file.submenu?.items.first?.title, "Close Tab")
        XCTAssertEqual(file.submenu?.items.first?.keyEquivalent, "w")
    }
}
