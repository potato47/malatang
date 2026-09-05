import AppKit
import SwiftUI
import WebKit
import XCTest

@testable import FIA

@MainActor
final class WindowAndWebTests: XCTestCase {
    func testUserClosePoliciesAndExplicitClose() throws {
        _ = NSApplication.shared
        var events: [AppWindowEvent] = []
        let native = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240), styleMask: [.titled, .closable],
            backing: .buffered, defer: false)
        let window = AppKitWindow(id: "hidden", window: native, userCloseAction: .hideWindow) { events.append($0) }
        try window.show()
        native.performClose(nil)
        XCTAssertEqual(window.state.lifecycle, .open)
        XCTAssertFalse(window.state.orderedIn)
        let count = events.count
        try window.hide()
        XCTAssertEqual(events.count, count)
        try window.close()
        XCTAssertEqual(window.state.lifecycle, .closed)
        XCTAssertEqual(events.last?.current, window.state)
        XCTAssertTrue(zip(events, events.dropFirst()).allSatisfy { $0.current == $1.previous })
    }

    func testRestoreUsesRegistrationOrderAndRecreatesClosedWindow() throws {
        let manager = WindowManager()
        manager.registerSwiftUI("z-first", title: "First") { Text("first") }
        manager.registerSwiftUI("a-second", title: "Second") { Text("second") }
        XCTAssertEqual(try manager.state("z-first").lifecycle, .registered)
        try manager.restoreMainWindow()
        XCTAssertEqual(try manager.state("z-first").lifecycle, .open)
        XCTAssertEqual(try manager.state("a-second").lifecycle, .registered)
        try manager.close("z-first")
        try manager.restoreMainWindow()
        XCTAssertEqual(try manager.state("z-first").lifecycle, .open)
        manager.mainWindowID = "a-second"
        try manager.restoreMainWindow()
        XCTAssertEqual(try manager.state("a-second").lifecycle, .open)
        try manager.close("z-first")
        try manager.close("a-second")
    }

    func testFullscreenFailureReconcilesToActualWindow() throws {
        var events: [AppWindowEvent] = []
        let window = AppKitWindow(id: "full", window: NSWindow(), emit: { events.append($0) })
        window.windowWillEnterFullScreen(Notification(name: NSWindow.willEnterFullScreenNotification))
        XCTAssertEqual(window.state.fullscreen, .entering)
        window.windowDidFailToEnterFullScreen(window.window)
        XCTAssertEqual(window.state.fullscreen, .windowed)
        XCTAssertEqual(events.count, 2)
        try window.close()
    }

    func testExternalWindowsNeedNoGatewayAndTrustedContentDoes() throws {
        let manager = WindowManager()
        manager.registerExternalWeb("outside", url: URL(string: "about:blank")!, title: "Outside")
        let window = try XCTUnwrap(try manager.show("outside") as? WebWindow)
        XCTAssertTrue(window.content is ExternalWebContent)
        XCTAssertFalse(window.webView.configuration.websiteDataStore.isPersistent)
        XCTAssertEqual(window.webView.configuration.userContentController.userScripts.count, 0)
        XCTAssertThrowsError(try manager.makeFIAContent(route: "/"))
        try window.close()
    }

    func testWebDataAndTrustPolicies() throws {
        let blank = URL(string: "about:blank")!
        let id = UUID()
        let first = ExternalWebContent(url: blank, dataStore: .persistent(id))
        let second = ExternalWebContent(url: blank, dataStore: .persistent(id))
        let other = ExternalWebContent(url: blank, dataStore: .persistent(UUID()))
        XCTAssertEqual(first.webView.configuration.websiteDataStore.identifier, id)
        XCTAssertEqual(second.webView.configuration.websiteDataStore.identifier, id)
        XCTAssertNotEqual(other.webView.configuration.websiteDataStore.identifier, id)
        XCTAssertTrue(first.allows(URL(string: "https://example.org")!))
        XCTAssertFalse(first.allows(URL(string: "file:///etc/passwd")!))
        XCTAssertNil(first.onPopup)
        XCTAssertNil(first.downloadDestination)
        let trusted = FIAWebContent(
            url: URL(string: "http://127.0.0.1:12345/_fia/bootstrap?code=test")!,
            trustedOrigins: [URL(string: "http://127.0.0.1:12345")!])
        XCTAssertTrue(trusted.allows(URL(string: "http://127.0.0.1:12345/path")!))
        XCTAssertFalse(trusted.allows(URL(string: "http://127.0.0.1:12346/path")!))
        XCTAssertFalse(trusted.allows(URL(string: "https://example.org")!))
        trusted.navigationPolicy = { _ in true }
        XCTAssertFalse(trusted.allows(URL(string: "https://example.org")!))
        XCTAssertFalse(trusted.webView.configuration.websiteDataStore.isPersistent)
    }
    func testPersistentCookieSharingAndIsolation() async throws {
        let id = UUID()
        let otherID = UUID()
        let first = ExternalWebContent(url: URL(string: "about:blank")!, dataStore: .persistent(id))
        let second = ExternalWebContent(url: URL(string: "about:blank")!, dataStore: .persistent(id))
        let other = ExternalWebContent(url: URL(string: "about:blank")!, dataStore: .persistent(otherID))
        let cookie = try XCTUnwrap(
            HTTPCookie(properties: [
                .domain: "fia.example", .path: "/", .name: "session", .value: "isolated",
                .expires: Date().addingTimeInterval(3600),
            ]))
        await withCheckedContinuation { done in
            first.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { done.resume() }
        }
        let shared = await cookies(second)
        let isolated = await cookies(other)
        XCTAssertTrue(shared.contains { $0.name == "session" && $0.value == "isolated" })
        XCTAssertFalse(isolated.contains { $0.name == "session" })
        await withCheckedContinuation { done in
            first.webView.configuration.websiteDataStore.httpCookieStore.delete(cookie) { done.resume() }
        }
    }

    private func cookies(_ content: WebContent) async -> [HTTPCookie] {
        await withCheckedContinuation { done in
            content.webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { done.resume(returning: $0) }
        }
    }

    func testPopupAndDownloadPoliciesHaveSafeDefaults() throws {
        let outside = ExternalWebContent(url: URL(string: "about:blank")!)
        let url = URL(string: "https://example.org/report")!
        let request = URLRequest(url: url)
        let configuration = WKWebViewConfiguration()
        let response = URLResponse(
            url: url, mimeType: "application/octet-stream", expectedContentLength: 10, textEncodingName: nil)
        XCTAssertNil(outside.makePopup(request: request, configuration: configuration))
        XCTAssertNil(outside.destination(response: response, filename: "report.bin"))
        let popup = WKWebView(frame: .zero, configuration: configuration)
        outside.onPopup = { incoming, config in
            XCTAssertEqual(incoming.url, url)
            XCTAssertTrue(config === configuration)
            return popup
        }
        XCTAssertTrue(outside.makePopup(request: request, configuration: configuration) === popup)
        outside.downloadDestination = { _, _ in url }
        XCTAssertNil(outside.destination(response: response, filename: "report.bin"))
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("fia-download.bin")
        outside.downloadDestination = { _, name in
            XCTAssertEqual(name, "report.bin")
            return file
        }
        XCTAssertEqual(outside.destination(response: response, filename: "report.bin"), file)
        let trusted = FIAWebContent(
            url: URL(string: "http://127.0.0.1:12345/")!, trustedOrigins: [URL(string: "http://127.0.0.1:12345")!])
        var externalURL: URL?
        trusted.onExternalLink = { externalURL = $0 }
        trusted.onPopup = { _, _ in
            XCTFail("Trusted popups must not inherit configuration")
            return popup
        }
        XCTAssertNil(trusted.makePopup(request: request, configuration: configuration))
        XCTAssertEqual(externalURL, url)
    }

}
