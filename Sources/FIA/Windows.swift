import AppKit
import Foundation
import SwiftUI
import WebKit

public enum AppWindowKind: String, Codable, Sendable {
    case web
    case swiftUI
    case appKit
}

public enum AppWindowVisibility: String, Codable, Sendable {
    case hidden
    case visible
    case closed
}

public struct AppWindowState: Codable, Sendable, Equatable {
    public let id: String
    public let kind: AppWindowKind
    public let visibility: AppWindowVisibility
    public let focused: Bool

    public init(id: String, kind: AppWindowKind, visibility: AppWindowVisibility, focused: Bool) {
        self.id = id
        self.kind = kind
        self.visibility = visibility
        self.focused = focused
    }
}

public enum AppWindowEvent: Sendable, Equatable {
    case opened(AppWindowState)
    case shown(AppWindowState)
    case hidden(AppWindowState)
    case focused(AppWindowState)
    case closed(AppWindowState)
}

@MainActor
public protocol AppWindow: AnyObject {
    var id: String { get }
    var kind: AppWindowKind { get }
    var state: AppWindowState { get }
    func show() throws
    func hide() throws
    func focus() throws
    func close() throws
}

@MainActor
open class AppKitWindow: NSObject, AppWindow, NSWindowDelegate {
    public let id: String
    public let kind: AppWindowKind
    public private(set) var visibility: AppWindowVisibility = .hidden
    public let window: NSWindow
    private let emit: (AppWindowEvent) -> Void
    private var performingProgrammaticChange = false

    public var state: AppWindowState {
        AppWindowState(id: id, kind: kind, visibility: visibility, focused: window.isKeyWindow)
    }

    public init(id: String, kind: AppWindowKind = .appKit, window: NSWindow, emit: @escaping (AppWindowEvent) -> Void = { _ in }) {
        self.id = id
        self.kind = kind
        self.window = window
        self.emit = emit
        super.init()
        window.delegate = self
        window.setFrameAutosaveName("fia.window.\(id)")
    }

    public func show() throws {
        guard visibility != .closed else { throw closed("show") }
        visibility = .visible
        performingProgrammaticChange = true
        window.makeKeyAndOrderFront(nil)
        performingProgrammaticChange = false
        emit(.shown(state))
    }

    public func hide() throws {
        guard visibility != .closed else { throw closed("hide") }
        visibility = .hidden
        performingProgrammaticChange = true
        window.orderOut(nil)
        performingProgrammaticChange = false
        emit(.hidden(state))
    }

    public func focus() throws {
        guard visibility != .closed else { throw closed("focus") }
        visibility = .visible
        performingProgrammaticChange = true
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        performingProgrammaticChange = false
        emit(.focused(state))
    }

    public func close() throws {
        guard visibility != .closed else { throw closed("close") }
        window.close()
    }

    private func closed(_ method: String) -> FIAError {
        FIAError(code: .unsafeState, component: "windows", method: method, message: "Window is already closed: \(id)")
    }

    public func windowWillClose(_ notification: Notification) {
        visibility = .closed
        emit(.closed(state))
    }

    public func windowDidBecomeKey(_ notification: Notification) {
        guard visibility != .closed, !performingProgrammaticChange else { return }
        visibility = .visible
        emit(.focused(state))
    }
}

@MainActor
public final class SwiftUIWindow: AppKitWindow {
    public init(id: String, title: String, size: CGSize, content: AnyView, emit: @escaping (AppWindowEvent) -> Void = { _ in }) {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.contentViewController = NSHostingController(rootView: content)
        window.center()
        super.init(id: id, kind: .swiftUI, window: window, emit: emit)
    }
}

@MainActor
public final class WebWindow: AppKitWindow, WKNavigationDelegate {
    public let webView: WKWebView

    public init(id: String, title: String, size: CGSize, url: URL, emit: @escaping (AppWindowEvent) -> Void = { _ in }) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.contentView = webView
        window.center()
        super.init(id: id, kind: .web, window: window, emit: emit)
        webView.navigationDelegate = self
        webView.customUserAgent = "FIA-WKWebView/2.0"
        webView.load(URLRequest(url: url))
    }

    public func reload() { webView.reload() }
}

@MainActor
public final class WindowManager {
    private struct Registration {
        let kind: AppWindowKind
        let factory: @MainActor () throws -> any AppWindow
    }

    private var registrations: [String: Registration] = [:]
    private var instances: [String: any AppWindow] = [:]
    private var continuations: [UUID: AsyncStream<AppWindowEvent>.Continuation] = [:]
    private var webURL: ((String) -> URL?)?

    public init() {}

    public var hasWebWindows: Bool { registrations.values.contains { $0.kind == .web } }
    public var registeredIDs: [String] { registrations.keys.sorted() }
    public var states: [AppWindowState] { instances.values.map(\.state).sorted { $0.id < $1.id } }

    public func configureWebURL(_ resolver: @escaping (String) -> URL?) { webURL = resolver }

    public func registerWeb(
        _ id: String,
        route: String,
        title: String,
        size: CGSize = CGSize(width: 1000, height: 720)
    ) {
        register(id, kind: .web) { [weak self] in
            guard let self, let url = self.webURL?(route) else {
                throw FIAError(
                    code: .capabilityUnavailable,
                    component: "windows",
                    method: "open",
                    message: "The Web gateway is not available"
                )
            }
            return WebWindow(id: id, title: title, size: size, url: url, emit: self.emit)
        }
    }

    public func registerSwiftUI<Content: View>(
        _ id: String,
        title: String,
        size: CGSize = CGSize(width: 720, height: 520),
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        register(id, kind: .swiftUI) { [weak self] in
            SwiftUIWindow(id: id, title: title, size: size, content: AnyView(content()), emit: self?.emit ?? { _ in })
        }
    }

    public func registerAppKit(_ id: String, factory: @escaping @MainActor () -> NSWindow) {
        register(id, kind: .appKit) { [weak self] in
            AppKitWindow(id: id, window: factory(), emit: self?.emit ?? { _ in })
        }
    }

    public func createWeb(
        _ id: String,
        route: String,
        title: String,
        size: CGSize = CGSize(width: 1000, height: 720)
    ) throws -> WebWindow {
        guard registrations[id] == nil, instances[id] == nil else {
            throw FIAError(code: .conflict, component: "windows", method: "createWeb", message: "Window already exists: \(id)")
        }
        guard let url = webURL?(route) else {
            throw FIAError(code: .capabilityUnavailable, component: "windows", method: "createWeb", message: "The Web gateway is not available")
        }
        let window = WebWindow(id: id, title: title, size: size, url: url, emit: emit)
        instances[id] = window
        emit(.opened(window.state))
        return window
    }

    @discardableResult
    public func show(_ id: String) throws -> any AppWindow {
        let window = try instance(id)
        try window.show()
        return window
    }

    public func hide(_ id: String) throws { try activeInstance(id, method: "hide").hide() }
    public func focus(_ id: String) throws { try instance(id).focus() }
    public func close(_ id: String) throws { try activeInstance(id, method: "close").close() }

    public func state(_ id: String) throws -> AppWindowState {
        if let current = instances[id] { return current.state }
        guard let registration = registrations[id] else { throw missing(id) }
        return AppWindowState(id: id, kind: registration.kind, visibility: .hidden, focused: false)
    }

    public func events() -> AsyncStream<AppWindowEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            continuations[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.continuations.removeValue(forKey: id) }
            }
        }
    }

    func registerNativeMethods(_ registry: NativeMethodRegistry) {
        registry.register("windows.createWeb", input: WebWindowInput.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run {
                let window = try self.createWeb(input.id, route: input.route, title: input.title)
                try window.show()
                return window.state
            }
        }
        registry.register("windows.open", input: WindowID.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.show(input.id).state }
        }
        registry.register("windows.hide", input: WindowID.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.hide(input.id); return try self.state(input.id) }
        }
        registry.register("windows.focus", input: WindowID.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.focus(input.id); return try self.state(input.id) }
        }
        registry.register("windows.close", input: WindowID.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.close(input.id); return try self.state(input.id) }
        }
        registry.register("windows.state", input: WindowID.self, output: AppWindowState.self, permission: "windows") { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.state(input.id) }
        }
    }

    func showInitialWindow() throws {
        guard let id = registeredIDs.first(where: { $0 == "main" }) ?? registeredIDs.first else { return }
        try show(id)
    }

    func register(_ id: String, kind: AppWindowKind, factory: @escaping @MainActor () throws -> any AppWindow) {
        precondition(!id.isEmpty && registrations[id] == nil, "Window IDs must be unique")
        registrations[id] = Registration(kind: kind, factory: factory)
    }

    private func instance(_ id: String) throws -> any AppWindow {
        if let current = instances[id], current.state.visibility != .closed { return current }
        guard let registration = registrations[id] else { throw missing(id) }
        let window = try registration.factory()
        instances[id] = window
        emit(.opened(window.state))
        return window
    }

    private func activeInstance(_ id: String, method: String) throws -> any AppWindow {
        guard let current = instances[id] else {
            if registrations[id] == nil { throw missing(id) }
            throw FIAError(
                code: .unsafeState,
                component: "windows",
                method: method,
                message: "Window is not open: \(id)"
            )
        }
        guard current.state.visibility != .closed else {
            throw FIAError(
                code: .unsafeState,
                component: "windows",
                method: method,
                message: "Window is already closed: \(id)"
            )
        }
        return current
    }

    private func missing(_ id: String) -> FIAError {
        FIAError(code: .notFound, component: "windows", method: "lookup", message: "Window is not registered: \(id)")
    }

    private func emit(_ event: AppWindowEvent) {
        for continuation in continuations.values { continuation.yield(event) }
    }
}

private struct WindowID: Codable, Sendable { let id: String }
private struct WebWindowInput: Codable, Sendable { let id: String; let route: String; let title: String }
