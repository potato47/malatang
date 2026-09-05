import AppKit
import Foundation
import SwiftUI
import WebKit

public enum AppWindowKind: String, Codable, Sendable {
    case web
    case swiftUI
    case appKit
}

public enum LastWindowClosedAction: Sendable { case keepRunning, quit }
public enum ReopenAction: Sendable { case restoreMainWindow, none }
public enum UserCloseAction: Sendable { case closeWindow, hideWindow, hideApplication }
public enum AppWindowLifecycle: String, Codable, Sendable { case registered, open, closed }
public enum AppWindowFullscreen: String, Codable, Sendable { case windowed, entering, fullscreen, exiting }

public struct AppWindowState: Codable, Sendable, Equatable {
    public let id: String
    public let kind: AppWindowKind
    public let lifecycle: AppWindowLifecycle
    public let orderedIn: Bool
    public let applicationHidden: Bool
    public let miniaturized: Bool
    public let focused: Bool
    public let fullscreen: AppWindowFullscreen

    public init(
        id: String, kind: AppWindowKind, lifecycle: AppWindowLifecycle, orderedIn: Bool = false,
        applicationHidden: Bool = false, miniaturized: Bool = false, focused: Bool = false,
        fullscreen: AppWindowFullscreen = .windowed
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

public struct AppWindowEvent: Codable, Sendable, Equatable {
    public enum Cause: String, Codable, Sendable {
        case created, show, hide, focus, close, userClose, application, system, fullscreen
    }
    public let previous: AppWindowState
    public let current: AppWindowState
    public let cause: Cause
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
    public let window: NSWindow
    public let userCloseAction: UserCloseAction
    private let emit: (AppWindowEvent) -> Void
    private var lifecycle: AppWindowLifecycle = .open
    private var fullscreen: AppWindowFullscreen = .windowed
    private var previous: AppWindowState
    private var performingProgrammaticChange = false
    var presentationAllowed: () -> Bool = { true }

    public var state: AppWindowState {
        AppWindowState(
            id: id, kind: kind, lifecycle: lifecycle,
            orderedIn: lifecycle == .open && window.isVisible,
            applicationHidden: NSApp?.isHidden ?? false,
            miniaturized: lifecycle == .open && window.isMiniaturized,
            focused: lifecycle == .open && window.isKeyWindow && (NSApp?.isActive ?? false) && !(NSApp?.isHidden ?? false),
            fullscreen: lifecycle == .open ? fullscreen : .windowed)
    }

    public init(
        id: String, kind: AppWindowKind = .appKit, window: NSWindow, userCloseAction: UserCloseAction = .closeWindow,
        emit: @escaping (AppWindowEvent) -> Void = { _ in }
    ) {
        self.id = id
        self.kind = kind
        self.window = window
        self.userCloseAction = userCloseAction
        self.emit = emit
        previous = AppWindowState(id: id, kind: kind, lifecycle: .open)
        super.init()
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("fia.window.\(id)")
        fullscreen = window.styleMask.contains(.fullScreen) ? .fullscreen : .windowed
        previous = state
        for name in [
            NSApplication.didHideNotification, NSApplication.didUnhideNotification,
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
        ] {
            NotificationCenter.default.addObserver(
                self, selector: #selector(applicationChanged), name: name, object: nil)
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func change(_ cause: AppWindowEvent.Cause, action: () -> Void) {
        performingProgrammaticChange = true
        action()
        performingProgrammaticChange = false
        reconcile(cause)
    }

    private func reconcile(_ cause: AppWindowEvent.Cause) {
        guard !performingProgrammaticChange else { return }
        let current = state
        guard current != previous else { return }
        let event = AppWindowEvent(previous: previous, current: current, cause: cause)
        previous = current
        emit(event)
    }

    private func requireOpen(_ method: String) throws {
        guard lifecycle == .open else {
            throw FIAError(code: .unsafeState, component: "windows", method: method, message: "Window is closed: \(id)")
        }
    }

    public func show() throws {
        guard presentationAllowed() else {
            throw FIAError(code: .unsafeState, component: "windows", message: "Runtime is shutting down")
        }
        try requireOpen("show")
        change(.show) {
            NSApp.unhide(nil)
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
    }
    public func hide() throws {
        try requireOpen("hide")
        change(.hide) { window.orderOut(nil) }
    }
    public func focus() throws {
        guard presentationAllowed() else {
            throw FIAError(code: .unsafeState, component: "windows", message: "Runtime is shutting down")
        }
        try requireOpen("focus")
        change(.focus) {
            NSApp.unhide(nil)
            NSApp.activate(ignoringOtherApps: true)
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
    }
    public func close() throws {
        try requireOpen("close")
        change(.close) { window.close() }
    }
    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        switch userCloseAction {
        case .closeWindow: return true
        case .hideWindow:
            change(.userClose) { window.orderOut(nil) }
            return false
        case .hideApplication:
            change(.userClose) { NSApp.hide(nil) }
            return false
        }
    }
    public func windowWillClose(_ notification: Notification) {
        lifecycle = .closed
        reconcile(.close)
    }
    public func windowDidBecomeKey(_ notification: Notification) { reconcile(.system) }
    public func windowDidResignKey(_ notification: Notification) { reconcile(.system) }
    public func windowDidMiniaturize(_ notification: Notification) { reconcile(.system) }
    public func windowDidDeminiaturize(_ notification: Notification) { reconcile(.system) }
    public func windowDidUpdate(_ notification: Notification) { reconcile(.system) }
    public func windowWillEnterFullScreen(_ notification: Notification) {
        fullscreen = .entering
        reconcile(.fullscreen)
    }
    public func windowDidEnterFullScreen(_ notification: Notification) {
        fullscreen = .fullscreen
        reconcile(.fullscreen)
    }
    public func windowWillExitFullScreen(_ notification: Notification) {
        fullscreen = .exiting
        reconcile(.fullscreen)
    }
    public func windowDidExitFullScreen(_ notification: Notification) {
        fullscreen = .windowed
        reconcile(.fullscreen)
    }
    public func windowDidFailToEnterFullScreen(_ window: NSWindow) { syncFullscreen() }
    public func windowDidFailToExitFullScreen(_ window: NSWindow) { syncFullscreen() }
    private func syncFullscreen() {
        fullscreen = window.styleMask.contains(.fullScreen) ? .fullscreen : .windowed
        reconcile(.fullscreen)
    }
    @objc private func applicationChanged(_ notification: Notification) { reconcile(.application) }
}

@MainActor
public final class SwiftUIWindow: AppKitWindow {
    public init(
        id: String, title: String, size: CGSize, content: AnyView, userCloseAction: UserCloseAction = .closeWindow,
        emit: @escaping (AppWindowEvent) -> Void = { _ in }
    ) {
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.contentViewController = NSHostingController(rootView: content)
        window.center()
        super.init(id: id, kind: .swiftUI, window: window, userCloseAction: userCloseAction, emit: emit)
    }
}

@MainActor
public final class WebWindow: AppKitWindow {
    public let content: WebContent
    public var webView: WKWebView { content.webView }
    public init(
        id: String, title: String, size: CGSize, content: WebContent, userCloseAction: UserCloseAction = .closeWindow,
        emit: @escaping (AppWindowEvent) -> Void = { _ in }
    ) {
        self.content = content
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = title
        window.contentView = content.webView
        window.center()
        super.init(id: id, kind: .web, window: window, userCloseAction: userCloseAction, emit: emit)
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
    private var trustedOrigins: [URL] = []
    private var shuttingDown = false
    private var registrationOrder: [String] = []
    public var mainWindowID: String?
    func beginShutdown() { shuttingDown = true }
    private func requireRunning() throws {
        guard !shuttingDown else {
            throw FIAError(code: .unsafeState, component: "windows", message: "Runtime is shutting down")
        }
    }
    public func restoreMainWindow() throws {
        try requireRunning()
        guard let id = mainWindowID ?? (registrations["main"] != nil ? "main" : registrationOrder.first) else { return }
        try focus(id)
    }

    public init() {}

    public var hasWebWindows: Bool { registrations.values.contains { $0.kind == .web } }
    public var registeredIDs: [String] { registrations.keys.sorted() }
    public var states: [AppWindowState] { instances.values.map(\.state).sorted { $0.id < $1.id } }

    func configureWebURL(trustedOrigins: [URL], _ resolver: @escaping (String) -> URL?) {
        self.trustedOrigins = trustedOrigins
        webURL = resolver
    }

    public func makeFIAContent(route: String) throws -> FIAWebContent {
        try requireRunning()
        guard let url = webURL?(route) else {
            throw FIAError(
                code: .capabilityUnavailable, component: "windows", message: "The Web gateway is not available")
        }
        return FIAWebContent(url: url, trustedOrigins: trustedOrigins)
    }

    public func registerExternalWeb(
        _ id: String, url: URL, title: String, size: CGSize = CGSize(width: 1000, height: 720),
        dataStore: WebsiteDataPolicy = .ephemeral, userCloseAction: UserCloseAction = .closeWindow
    ) {
        register(id, kind: .web) { [weak self] in
            WebWindow(
                id: id, title: title, size: size, content: ExternalWebContent(url: url, dataStore: dataStore),
                userCloseAction: userCloseAction, emit: self?.emit ?? { _ in })
        }
    }

    public func registerFIAWeb(
        _ id: String,
        route: String,
        title: String,
        size: CGSize = CGSize(width: 1000, height: 720),
        userCloseAction: UserCloseAction = .closeWindow
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
            return WebWindow(
                id: id, title: title, size: size, content: FIAWebContent(url: url, trustedOrigins: self.trustedOrigins),
                userCloseAction: userCloseAction, emit: self.emit)
        }
    }

    public func registerSwiftUI<Content: View>(
        _ id: String,
        title: String,
        size: CGSize = CGSize(width: 720, height: 520),
        userCloseAction: UserCloseAction = .closeWindow,
        @ViewBuilder content: @escaping @MainActor () -> Content
    ) {
        register(id, kind: .swiftUI) { [weak self] in
            SwiftUIWindow(
                id: id, title: title, size: size, content: AnyView(content()), userCloseAction: userCloseAction,
                emit: self?.emit ?? { _ in })
        }
    }

    public func registerAppKit(
        _ id: String, userCloseAction: UserCloseAction = .closeWindow, factory: @escaping @MainActor () -> NSWindow
    ) {
        register(id, kind: .appKit) { [weak self] in
            AppKitWindow(id: id, window: factory(), userCloseAction: userCloseAction, emit: self?.emit ?? { _ in })
        }
    }

    public func createWeb(
        _ id: String,
        route: String,
        title: String,
        size: CGSize = CGSize(width: 1000, height: 720),
        userCloseAction: UserCloseAction = .closeWindow
    ) throws -> WebWindow {
        try requireRunning()
        guard registrations[id] == nil, instances[id] == nil else {
            throw FIAError(
                code: .conflict, component: "windows", method: "createWeb", message: "Window already exists: \(id)")
        }
        guard let url = webURL?(route) else {
            throw FIAError(
                code: .capabilityUnavailable, component: "windows", method: "createWeb",
                message: "The Web gateway is not available")
        }
        let window = WebWindow(
            id: id, title: title, size: size, content: FIAWebContent(url: url, trustedOrigins: trustedOrigins),
            userCloseAction: userCloseAction, emit: emit)
        window.presentationAllowed = { [weak self] in self?.shuttingDown == false }
        instances[id] = window
        emit(
            AppWindowEvent(
                previous: AppWindowState(id: id, kind: window.kind, lifecycle: .registered), current: window.state,
                cause: .created))
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
        return AppWindowState(
            id: id, kind: registration.kind, lifecycle: .registered, applicationHidden: NSApp?.isHidden ?? false)
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
        registry.register(
            "windows.createWeb", input: WebWindowInput.self, output: AppWindowState.self, permission: "windows"
        ) { [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run {
                let window = try self.createWeb(input.id, route: input.route, title: input.title)
                try window.show()
                return window.state
            }
        }
        registry.register("windows.open", input: WindowID.self, output: AppWindowState.self, permission: "windows") {
            [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.show(input.id).state }
        }
        registry.register("windows.hide", input: WindowID.self, output: AppWindowState.self, permission: "windows") {
            [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run {
                try self.hide(input.id)
                return try self.state(input.id)
            }
        }
        registry.register("windows.focus", input: WindowID.self, output: AppWindowState.self, permission: "windows") {
            [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run {
                try self.focus(input.id)
                return try self.state(input.id)
            }
        }
        registry.register("windows.close", input: WindowID.self, output: AppWindowState.self, permission: "windows") {
            [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run {
                try self.close(input.id)
                return try self.state(input.id)
            }
        }
        registry.register("windows.state", input: WindowID.self, output: AppWindowState.self, permission: "windows") {
            [weak self] input in
            guard let self else { throw CancellationError() }
            return try await MainActor.run { try self.state(input.id) }
        }
    }

    func showInitialWindow() throws {
        guard let id = mainWindowID ?? (registrations["main"] != nil ? "main" : registrationOrder.first) else { return }
        try show(id)
    }

    func register(_ id: String, kind: AppWindowKind, factory: @escaping @MainActor () throws -> any AppWindow) {
        precondition(
            !shuttingDown && !id.isEmpty && registrations[id] == nil && instances[id] == nil,
            "Register unique windows before shutdown")
        registrationOrder.append(id)
        registrations[id] = Registration(kind: kind, factory: factory)
    }

    private func instance(_ id: String) throws -> any AppWindow {
        try requireRunning()
        if let current = instances[id], current.state.lifecycle != .closed { return current }
        guard let registration = registrations[id] else { throw missing(id) }
        let previous = try state(id)
        let window = try registration.factory()
        (window as? AppKitWindow)?.presentationAllowed = { [weak self] in self?.shuttingDown == false }
        instances[id] = window
        emit(AppWindowEvent(previous: previous, current: window.state, cause: .created))
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
        guard current.state.lifecycle != .closed else {
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
private struct WebWindowInput: Codable, Sendable {
    let id: String
    let route: String
    let title: String
}
