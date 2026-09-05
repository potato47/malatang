@testable import FIA
@testable import FIAMacOS
@testable import FIAUpdater
import AppKit
import XCTest
import SwiftUI

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
        _ = await first.value
        _ = await second.value
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

@MainActor
final class LifecycleRefactorTests: XCTestCase {
    func testTimeoutDoesNotWaitForUncooperativeTaskOrRepeatHandlers() async throws {
        let runtime = try FIARuntime(manifest: RuntimeManifest.load())
        var release: CheckedContinuation<Void, Never>?
        var calls: [String] = []
        runtime.onShutdown(name: "first") { calls.append("first") }
        runtime.onShutdown(name: "hung", timeout: .milliseconds(20)) {
            await withCheckedContinuation { release = $0 }
            calls.append("late")
        }
        runtime.onShutdown(name: "throws") { throw ManagedProcessError("expected failure") }
        let report = await runtime.prepareForUpdate()
        XCTAssertTrue(report.completed)
        XCTAssertEqual(report.reason, .update)
        XCTAssertEqual(report.issues.map(\.name), ["throws", "hung"])
        XCTAssertEqual(calls, ["first"])
        XCTAssertEqual(runtime.lifecycle, .stopped)
        release?.resume()
        await Task.yield()
        let repeated = await runtime.stop()
        XCTAssertEqual(repeated.reason, .update)
        XCTAssertEqual(repeated.issues, report.issues)
        XCTAssertEqual(calls, ["first", "late"])
        XCTAssertThrowsError(try runtime.startProcess(ManagedProcess(executable: URL(fileURLWithPath: "/usr/bin/true"))))
    }

    func testShutdownRejectsRPCAndWindowRecoveryBeforeCallbacks() async throws {
        let runtime = try FIARuntime(manifest: RuntimeManifest.load())
        runtime.windows.registerSwiftUI("main", title: "Test") { Text("test") }
        let window = try runtime.windows.show("main")
        runtime.onShutdown {
            XCTAssertEqual(runtime.lifecycle, .shuttingDown)
            XCTAssertThrowsError(try runtime.windows.focus("main"))
            XCTAssertThrowsError(try window.show())
            let result = await runtime.native.dispatch(method: "application.info", params: Data("{}".utf8))
            guard case let .failure(error as FIAError) = result else { return XCTFail("Expected shutdown rejection") }
            XCTAssertEqual(error.code, .unsafeState)
        }
        let report = await runtime.stop()
        XCTAssertTrue(report.completed)
        try window.close()
    }

    func testDefaultMenuInstallationAndHeadlessContract() throws {
        _ = NSApplication.shared
        let original = NSApp.mainMenu
        let originalWindows = NSApp.windowsMenu
        defer { NSApp.mainMenu = original; NSApp.windowsMenu = originalWindows }
        let manifest = try RuntimeManifest.load()
        let runtime = try FIARuntime(manifest: manifest)
        var order: [Int] = []
        runtime.customizeMenu { menu in
            XCTAssertNotNil(menu.items.first { $0.title == "File" })
            order.append(1)
        }
        runtime.customizeMenu { _ in order.append(2) }
        runtime.finishConfiguration()
        let delegate = ApplicationDelegate(runtime: runtime, manifest: manifest, headless: false)
        XCTAssertFalse(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApp))
        runtime.lastWindowClosedAction = .quit
        XCTAssertTrue(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApp))
        delegate.installMenu()
        delegate.installMenu()
        XCTAssertEqual(order, [1, 2])
        let headless = try FIARuntime(manifest: manifest)
        headless.customizeMenu { _ in XCTFail("Headless must not customize a menu") }
        ApplicationDelegate(runtime: headless, manifest: manifest, headless: true).installMenu()
    }
}

@MainActor
final class ShutdownRetryTests: XCTestCase {
    func testFailedManagedStopBlocksCompletionAndRetriesWithoutRepeatingCallbacks() async throws {
        let runtime = try FIARuntime(manifest: RuntimeManifest.load())
        let process = ManagedProcess(executable: URL(fileURLWithPath: "/bin/sh"), arguments: ["-c", "read command"])
        try runtime.startProcess(process)
        let original = process.groupState
        process.groupState = { _, _ in -1 }
        var calls = 0
        runtime.onShutdown { calls += 1 }
        let failed = await runtime.prepareForUpdate()
        XCTAssertFalse(failed.completed)
        XCTAssertEqual(runtime.lifecycle, .shuttingDown)
        XCTAssertEqual(calls, 1)
        process.groupState = original
        try process.write(Data("quit\n".utf8))
        let retried = await runtime.stop()
        XCTAssertTrue(retried.completed)
        XCTAssertEqual(retried.reason, .update)
        XCTAssertEqual(runtime.lifecycle, .stopped)
        XCTAssertEqual(calls, 1)
        XCTAssertNotNil(process.terminationStatus)
    }
}

@MainActor
final class UpdatePreparationTests: XCTestCase {
    func testFailedPreparationCanRetryAndOnlyInvokesRelaunchOnce() async throws {
        let updater = UpdateManager()
        var attempts = 0, relaunches = 0, failures = 0
        updater.reportPreparationFailure = { _ in failures += 1 }
        updater.beforeInstall = {
            attempts += 1
            if attempts == 1 { throw ManagedProcessError("stop failed") }
        }
        XCTAssertTrue(updater.postponeRelaunch { relaunches += 1 })
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(failures, 1)
        XCTAssertEqual(relaunches, 0)
        try updater.checkForUpdates()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(relaunches, 1)
    }
}
