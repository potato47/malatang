@testable import FIA
import SwiftUI
import WebKit
import XCTest

@MainActor
final class RuntimeContractTests: XCTestCase {
    func testUnifiedErrorRoundTrips() throws {
        let value = FIAError(
            code: .capabilityUnavailable,
            component: "windows",
            method: "minimize",
            message: "Unavailable",
            recoverable: false
        )
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try JSONDecoder().decode(FIAError.self, from: data).code, .capabilityUnavailable)

        let custom = FIAError(
            code: TestApplicationError.documentLocked,
            component: "documents",
            method: "save",
            message: "Locked",
            recoverable: true
        )
        let customData = try JSONEncoder().encode(custom)
        XCTAssertEqual(try JSONDecoder().decode(FIAError.self, from: customData).code.rawValue, "document_locked")
    }

    func testResourceLimitsAreStable() {
        XCTAssertEqual(ResourceStore.maximumCount, 128)
        XCTAssertEqual(ResourceStore.maximumBytes, 512 * 1024 * 1024)
        XCTAssertEqual(ResourceStore.timeToLive, 600)
        XCTAssertEqual(NativeMethodRegistry.maximumConcurrentCalls, 128)
    }

    func testUpdaterExposesSparklePostponeHook() {
        let updater = UpdateManager()
        XCTAssertTrue(updater.responds(to: NSSelectorFromString("updater:shouldPostponeRelaunchForUpdate:untilInvokingBlock:")))
    }

    func testWindowStateInspectionDoesNotCreateOrReopenWindows() throws {
        var creations = 0
        let manager = WindowManager()
        manager.register("main", kind: .appKit) {
            creations += 1
            return TestWindow(id: "main")
        }

        XCTAssertEqual(try manager.state("main").visibility, .hidden)
        XCTAssertEqual(creations, 0)
        try manager.show("main")
        XCTAssertEqual(creations, 1)
        try manager.close("main")
        XCTAssertEqual(try manager.state("main").visibility, .closed)
        XCTAssertEqual(creations, 1)
        try manager.focus("main")
        XCTAssertEqual(try manager.state("main").visibility, .visible)
        XCTAssertEqual(creations, 2)
        try manager.close("main")
    }

    func testWindowManagerRecreatesClosedSwiftUIWindows() throws {
        let manager = WindowManager()
        manager.registerSwiftUI("reopen", title: "Reopen") { Text("FIA") }

        let first = try manager.show("reopen")
        let firstWindow = try XCTUnwrap(first as? AppKitWindow)
        XCTAssertFalse(firstWindow.window.isReleasedWhenClosed)
        try manager.close("reopen")
        XCTAssertEqual(first.state.visibility, .closed)

        let second = try manager.show("reopen")
        XCTAssertFalse(first === second)
        XCTAssertEqual(second.state.visibility, .visible)
        try manager.close("reopen")
    }

    func testWebWindowDisablesRubberBanding() throws {
        let window = WebWindow(
            id: "web",
            title: "Web",
            size: CGSize(width: 320, height: 240),
            url: URL(string: "about:blank")!
        )
        defer { try? window.close() }

        let selector = NSSelectorFromString("_rubberBandingEnabled")
        XCTAssertTrue(window.webView.responds(to: selector))
        typealias GetRubberBandingEdges = @convention(c) (AnyObject, Selector) -> UInt
        let getter = unsafeBitCast(
            window.webView.method(for: selector),
            to: GetRubberBandingEdges.self
        )
        XCTAssertEqual(getter(window.webView, selector), 0)
    }

    func testResourcesAreSessionIsolatedAndDisposable() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "fia-resource-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        let store = try ResourceStore(directory: directory)
        let origin = try XCTUnwrap(URL(string: "http://127.0.0.1:12345"))
        let resource = try await store.create(
            data: Data("payload".utf8),
            contentType: "text/plain",
            session: "session-a",
            origin: origin
        )

        let ownerRead = await store.resource(id: resource.descriptor.id, session: "session-a")
        let crossSessionRead = await store.resource(id: resource.descriptor.id, session: "session-b")
        XCTAssertNotNil(ownerRead)
        XCTAssertNil(crossSessionRead)
        await store.dispose(id: resource.descriptor.id, session: "session-b")
        let afterCrossSessionDispose = await store.resource(id: resource.descriptor.id, session: "session-a")
        XCTAssertNotNil(afterCrossSessionDispose)
        await store.dispose(id: resource.descriptor.id, session: "session-a")
        let afterOwnerDispose = await store.resource(id: resource.descriptor.id, session: "session-a")
        XCTAssertNil(afterOwnerDispose)
        XCTAssertFalse(FileManager.default.fileExists(atPath: resource.fileURL.path))
    }

    func testNativeRegistryValidatesInputAndQuiescesActiveOperations() async throws {
        let registry = NativeMethodRegistry()
        registry.register("test.wait", input: WaitInput.self, output: String.self) { input in
            try await Task.sleep(for: .seconds(input.seconds))
            return "finished"
        }
        let invalid = await registry.dispatch(method: "test.wait", params: Data(#"{"seconds":"bad"}"#.utf8))
        guard case let .failure(invalidError as FIAError) = invalid else { return XCTFail("expected FIAError") }
        XCTAssertEqual(invalidError.code, .invalidArgument)

        let call = Task { await registry.dispatch(method: "test.wait", params: Data(#"{"seconds":30}"#.utf8)) }
        await Task.yield()
        registry.beginShutdown()
        registry.cancelActive()
        guard case let .failure(cancelled as FIAError) = await call.value else { return XCTFail("expected cancellation") }
        XCTAssertEqual(cancelled.code, .cancelled)

        let rejected = await registry.dispatch(method: "test.wait", params: Data(#"{"seconds":0}"#.utf8))
        guard case let .failure(rejectedError as FIAError) = rejected else { return XCTFail("expected shutdown rejection") }
        XCTAssertEqual(rejectedError.code, .unsafeState)
    }
}

private struct WaitInput: Decodable, Sendable { let seconds: Int }
private enum TestApplicationError: String { case documentLocked = "document_locked" }

@MainActor
private final class TestWindow: AppWindow {
    let id: String
    let kind: AppWindowKind = .appKit
    private var visibility: AppWindowVisibility = .hidden
    private var focused = false

    init(id: String) { self.id = id }

    var state: AppWindowState {
        AppWindowState(id: id, kind: kind, visibility: visibility, focused: focused)
    }

    func show() throws { visibility = .visible }
    func hide() throws { visibility = .hidden; focused = false }
    func focus() throws { visibility = .visible; focused = true }
    func close() throws { visibility = .closed; focused = false }
}
