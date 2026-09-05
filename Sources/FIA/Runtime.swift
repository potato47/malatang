import AppKit
import FIACore
import FIAMacOS
import FIAUpdater
import FIAWeb
import Foundation

@_exported import FIAUpdater
@_exported import FIAMacOS

public enum BunServiceState: Sendable, Equatable {
    case disabled
    case starting
    case ready(URL)
    case restarting(Int)
    case failed(String)
    case stopping
    case stopped
}

private final class BackendOrigin: @unchecked Sendable {
    private let lock = NSLock()
    private var value: URL?
    private var session: String?
    private var mount = "/api"
    init(mount: String = "/api") { self.mount = mount }
    func get() -> URL? { lock.withLock { value } }
    func endpoint() -> FIABackendEndpoint? {
        lock.withLock {
            guard let value, let session else { return nil }
            return FIABackendEndpoint(origin: value, session: session, mount: mount)
        }
    }
    func set(_ value: URL?, session: String? = nil) { lock.withLock { self.value = value; self.session = session } }
}

@MainActor
public final class BunSupervisor {
    public private(set) var state: BunServiceState = .disabled
    private var supervisor: BackendSupervisor?
    private let origin: BackendOrigin

    fileprivate init(origin: BackendOrigin) { self.origin = origin }

    fileprivate func start(
        executable: URL,
        appName: String,
        identifier: String,
        development: Bool,
        sha256: String,
        nativeOrigin: String,
        nativeSession: String,
        native: NativeMethodRegistry
    ) {
        let configuration = FIABunConfiguration(
            development: development,
            appName: appName,
            appIdentifier: identifier,
            executable: development ? executable.path : "Helpers/FIABackend",
            sha256: sha256,
            nativeOrigin: nativeOrigin,
            nativeSession: nativeSession
        )
        do {
            let supervisor = try BackendSupervisor(configuration: configuration) { method, params in
                let input = try JSONSerialization.data(withJSONObject: params, options: .fragmentsAllowed)
                switch await native.dispatch(method: method, params: input) {
                case let .success(data):
                    return try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
                case let .failure(error): throw error
                }
            } onState: { [weak self] state in
                guard let self else { return }
                switch state {
                case .starting: self.state = .starting
                case let .ready(port):
                    let url = URL(string: "http://127.0.0.1:\(port)")!
                    self.origin.set(url, session: self.supervisor?.sessionToken)
                    self.state = .ready(url)
                case let .restarting(attempt):
                    self.origin.set(nil)
                    self.state = .restarting(attempt)
                case let .failed(reason):
                    self.origin.set(nil)
                    self.state = .failed(reason)
                case .stopping: self.state = .stopping
                case .stopped:
                    self.origin.set(nil)
                    self.state = .stopped
                }
            }
            self.supervisor = supervisor
            state = .starting
            supervisor.start()
        } catch {
            supervisor = nil
            origin.set(nil)
            state = .failed(error.localizedDescription)
        }
    }

    private var startsDisabled = false
    fileprivate func disableStarts() { startsDisabled = true }
    public func retry() { if !startsDisabled { supervisor?.retry() } }
    public func send(event: String, payload: Any? = nil) { supervisor?.sendEvent(event, payload: payload) }
    fileprivate func stop() async throws { try await supervisor?.stop() }

}

public struct FIAPermissions: Codable, Sendable {
    public let values: [String: Bool]
    public func allows(_ capability: String) -> Bool { values[capability] == true }
}

@MainActor
public final class FIARuntime {
    public let windows = WindowManager()
    public let native = NativeMethodRegistry()
    public let resources: ResourceStore
    public let updater = UpdateManager()
    public let clipboard = ClipboardService()
    public let dialogs = DialogService()
    public let notifications = NotificationService()
    public let screens = ScreenService()
    public let screenCapture = ScreenCaptureService()
    public let system = SystemService()
    public let shortcuts = ShortcutService()
    public let keychain: KeychainService
    public let bun: BunSupervisor
    public let permissions: FIAPermissions

    public private(set) var lifecycle: RuntimeLifecycle = .running
    public private(set) var shutdownReport: ShutdownReport?
    public var lastWindowClosedAction: LastWindowClosedAction = .keepRunning
    public var reopenAction: ReopenAction = .restoreMainWindow
    private var shutdownHandlers: [(name: String, timeout: Duration, handler: @MainActor () async throws -> Void)] = []
    private var shutdownTask: Task<ShutdownReport, Never>?
    private var handlerTask: Task<[ShutdownIssue], Never>?
    private var shutdownReason: ShutdownReason?
    private var managedProcesses: [ManagedProcess] = []
    private var menuHandlers: [@MainActor (NSMenu) -> Void] = []
    private var configuring = true
    private var menuInstalled = false

    public func onShutdown(name: String = "Application cleanup", timeout: Duration = .seconds(10), _ handler: @escaping @MainActor () async throws -> Void) {
        precondition(lifecycle == .running, "Cannot register cleanup after shutdown has started")
        precondition(timeout > .zero, "Cleanup timeout must be positive")
        shutdownHandlers.append((name, timeout, handler))
    }

    /// Runtime ownership guarantees that process stop failures block termination.
    public func startProcess(_ process: ManagedProcess) throws {
        guard lifecycle == .running else { throw ManagedProcessError("Runtime is shutting down") }
        try process.start()
        managedProcesses.append(process)
    }

    public func customizeMenu(_ handler: @escaping @MainActor (NSMenu) -> Void) {
        precondition(configuring, "Register menu customization during application configuration")
        menuHandlers.append(handler)
    }

    func finishConfiguration() { configuring = false }

    func customizeApplicationMenu(_ menu: NSMenu) {
        guard !menuInstalled else { return }
        menuInstalled = true
        for handler in menuHandlers { handler(menu) }
        menuHandlers.removeAll()
    }

    @discardableResult
    func runShutdownHandlers() async -> [ShutdownIssue] {
        if let handlerTask { return await handlerTask.value }
        let handlers = shutdownHandlers
        shutdownHandlers.removeAll()
        let task = Task { @MainActor in
            var issues: [ShutdownIssue] = []
            for entry in handlers.reversed() {
                if let issue = await ShutdownRace().run(name: entry.name, timeout: entry.timeout, handler: entry.handler) {
                    issues.append(issue)
                }
            }
            return issues
        }
        handlerTask = task
        return await task.value
    }

    private let manifest: RuntimeManifest
    private let backendOrigin: BackendOrigin
    private var updaterAvailable = false
    private var gateway: FIAGateway?
    private var endpoint: FIAGatewayEndpoint?
    private var windowEventsTask: Task<Void, Never>?
    private var updaterEventsTask: Task<Void, Never>?

    init(manifest: RuntimeManifest) throws {
        self.manifest = manifest
        backendOrigin = BackendOrigin(mount: manifest.backend.mount)
        permissions = FIAPermissions(values: manifest.permissions)
        native.setPermissions(manifest.permissions)
        resources = try ResourceStore()
        keychain = KeychainService(service: manifest.app.identifier)
        bun = BunSupervisor(origin: backendOrigin)
        windows.registerNativeMethods(native)
        registerServices()
        shortcuts.onPressed = { [weak self] id in
            try? self?.emit("globalShortcuts.pressed", payload: ShortcutPressed(id: id))
        }
        if manifest.updater != nil {
            updater.enable()
            if updater.isEnabled { registerUpdaterService() }
        }
        updaterAvailable = updater.isEnabled
        updater.beforeInstall = { [weak self] in
            guard let self else { return }
            let report = await self.prepareForUpdate()
            guard report.completed else { throw ManagedProcessError(report.issues.map(\.message).joined(separator: "\n")) }
        }
    }

    func start() async throws {
        guard lifecycle == .running else { throw ManagedProcessError("Runtime is shutting down") }
        finishConfiguration()
        let environment = ProcessInfo.processInfo.environment
        let developmentOrigin = environment["FIA_WEB_DEV_URL"].flatMap(URL.init(string:))
        let needsGateway = manifest.web.enabled || manifest.backend.enabled || environment["FIA_ENDPOINT_FILE"] != nil
        if needsGateway {
            let staticDirectory = manifest.web.enabled
                ? Bundle.main.resourceURL?.appending(path: manifest.web.directory ?? "web", directoryHint: .isDirectory)
                : nil
            let registry = native
            let store = resources
            let backendOrigin = backendOrigin
            let updaterAvailable = self.updaterAvailable
            let gateway = FIAGateway(
                staticDirectory: staticDirectory,
                developmentOrigin: developmentOrigin,
                backendMount: manifest.backend.mount,
                backendEndpoint: { backendOrigin.endpoint() },
                dispatcher: { [manifest] method, params, mode in
                    if method == "native.capabilities" {
                        var available = manifest.permissions
                        available["native"] = true
                        available["resources"] = true
                        available["windows"] = mode == "application" && manifest.permissions["windows"] == true
                        available["updater"] = updaterAvailable
                        let capabilities: [String: Any] = [
                            "mode": mode,
                            "protocolVersion": 1,
                            "capabilities": available,
                        ]
                        return .success((try? JSONSerialization.data(withJSONObject: capabilities)) ?? Data("{}".utf8))
                    }
                    if mode == "browserCompanion", method.hasPrefix("windows.") {
                        return .failure(FIAError(
                            code: .capabilityUnavailable,
                            component: "windows",
                            method: method,
                            message: "This window capability is unavailable in Browser Companion"
                        ))
                    }
                    return await registry.dispatch(method: method, params: params)
                },
                resource: { id, session in
                    guard let resource = await store.resource(id: id, session: session) else { return nil }
                    return FIAGatewayResource(
                        fileURL: resource.fileURL,
                        contentType: resource.descriptor.contentType,
                        size: resource.descriptor.byteLength
                    )
                }
            )
            let endpoint = try gateway.start()
            self.gateway = gateway
            self.endpoint = endpoint
            windows.configureWebURL(trustedOrigins: [URL(string: endpoint.origin)!] + (developmentOrigin.map { [$0] } ?? [])) { [weak gateway] route in gateway?.makeBootstrapURL(target: route) }
            if let path = environment["FIA_ENDPOINT_FILE"] {
                let data = try JSONEncoder().encode(endpoint)
                let file = URL(fileURLWithPath: path)
                try data.write(to: file, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            }
            let windowEvents = windows.events()
            windowEventsTask = Task { @MainActor [weak self, weak gateway] in
                guard let self else { return }
                for await event in windowEvents {
                    guard !Task.isCancelled else { return }
                    let payload = event
                    let data = try? JSONEncoder().encode(payload)
                    gateway?.publish(event: "windows.changed", payload: data)
                    self.bun.send(event: "windows.changed", payload: data.flatMap {
                        try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed)
                    })
                }
            }
            if updaterAvailable {
                updaterEventsTask = Task { @MainActor [weak self, weak gateway] in
                    guard let self else { return }
                    for await state in self.updater.states() {
                        guard !Task.isCancelled else { return }
                        let payload = UpdateStatePayload(state)
                        let data = try? JSONEncoder().encode(payload)
                        gateway?.publish(event: "updater.stateChanged", payload: data)
                        self.bun.send(event: "updater.stateChanged", payload: data.flatMap {
                            try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed)
                        })
                    }
                }
            }
        }

        if manifest.backend.enabled, let name = manifest.backend.executable, let sha256 = manifest.backend.sha256,
           let endpoint {
            let executable = Bundle.main.bundleURL.appending(path: "Contents").appending(path: name)
            bun.start(
                executable: executable,
                appName: manifest.app.name,
                identifier: manifest.app.identifier,
                development: environment["FIA_DEVELOPMENT"] == "1",
                sha256: sha256,
                nativeOrigin: endpoint.origin,
                nativeSession: endpoint.session,
                native: native
            )
        }
        if environment["FIA_DEV_READY_FILE"] != nil {
            try await waitForDevelopmentServer(path: environment["FIA_DEV_READY_FILE"]!)
        }
        if environment["FIA_HEADLESS"] != "1" { try windows.showInitialWindow() }
    }

    @discardableResult
    public func prepareForUpdate() async -> ShutdownReport { await shutdown(reason: .update) }

    public func emit<Event: Encodable & Sendable>(_ event: String, payload: Event) throws {
        let data = try JSONEncoder().encode(payload)
        gateway?.publish(event: event, payload: data)
        bun.send(event: event, payload: try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed))
    }

    @discardableResult
    func stop() async -> ShutdownReport { await shutdown(reason: .quit) }

    private func shutdown(reason: ShutdownReason) async -> ShutdownReport {
        if let shutdownTask { return await shutdownTask.value }
        let first = shutdownReason == nil
        if first { shutdownReason = reason }
        lifecycle = .shuttingDown
        windows.beginShutdown()
        bun.disableStarts()
        native.beginShutdown()
        if first, shutdownReason == .update { try? emit("app.willUpdate", payload: UpdateWillInstall()) }
        native.cancelActive()
        let task = Task { @MainActor in
            var issues = await self.runShutdownHandlers()
            var processesStopped = true
            do { try await self.bun.stop() } catch {
                processesStopped = false
                issues.append(ShutdownIssue(name: "Bun backend", message: error.localizedDescription))
            }
            for process in self.managedProcesses {
                do { try await process.stop() } catch {
                    processesStopped = false
                    issues.append(ShutdownIssue(name: "Process \(process.processIdentifier)", message: error.localizedDescription))
                }
            }
            if processesStopped {
                self.shortcuts.clear()
                await self.resources.cleanupAll()
                self.windowEventsTask?.cancel()
                self.updaterEventsTask?.cancel()
                await self.gateway?.stop()
                self.lifecycle = .stopped
            }
            return ShutdownReport(reason: self.shutdownReason!, issues: issues, completed: processesStopped)
        }
        shutdownTask = task
        let report = await task.value
        shutdownReport = report
        for issue in report.issues {
            try? FileHandle.standardError.write(contentsOf: Data("FIA cleanup [\(issue.name)]: \(issue.message)\n".utf8))
        }
        if !report.completed { shutdownTask = nil }
        return report
    }

    private func registerServices() {
        native.register("application.info", input: FIAEmpty.self, output: ApplicationInfo.self, permission: "application") { [manifest] _ in
            ApplicationInfo(name: manifest.app.name, identifier: manifest.app.identifier, version: manifest.app.version, build: manifest.app.build)
        }
        native.register("application.quit", input: FIAEmpty.self, output: FIAEmpty.self, permission: "application") { _ in
            await MainActor.run { FIAApplication.requestQuit() }
            return FIAEmpty()
        }
        native.register("clipboard.readText", input: FIAEmpty.self, output: Optional<String>.self, permission: "clipboard") { [clipboard] _ in
            await MainActor.run { clipboard.readText() }
        }
        native.register("clipboard.writeText", input: ClipboardText.self, output: FIAEmpty.self, permission: "clipboard") { [clipboard] input in
            let success = await MainActor.run { clipboard.writeText(input.text) }
            if !success { throw FIAError(code: .nativeFailure, component: "clipboard", method: "writeText", message: "macOS rejected the clipboard write") }
            return FIAEmpty()
        }
        native.register("dialogs.openFiles", input: OpenFilesInput.self, output: Optional<[String]>.self, permission: "dialogs") { [dialogs] input in
            await dialogs.openFiles(allowsMultipleSelection: input.multiple)?.map(\.path)
        }
        native.register("dialogs.saveFile", input: SaveFileInput.self, output: Optional<String>.self, permission: "dialogs") { [dialogs] input in
            await dialogs.saveFile(suggestedName: input.suggestedName)?.path
        }
        native.register("keychain.get", input: KeyInput.self, output: Optional<String>.self, permission: "keychain") { [keychain] input in
            try keychain.value(for: input.key)
        }
        native.register("keychain.set", input: KeyValueInput.self, output: FIAEmpty.self, permission: "keychain") { [keychain] input in
            try keychain.set(input.value, for: input.key)
            return FIAEmpty()
        }
        native.register("keychain.delete", input: KeyInput.self, output: Bool.self, permission: "keychain") { [keychain] input in
            try keychain.delete(input.key)
        }
        native.register("notifications.requestAuthorization", input: FIAEmpty.self, output: Bool.self, permission: "notifications") { [notifications] _ in
            try await notifications.requestAuthorization()
        }
        native.register("notifications.deliver", input: NotificationInput.self, output: FIAEmpty.self, permission: "notifications") { [notifications] input in
            try await notifications.deliver(title: input.title, body: input.body)
            return FIAEmpty()
        }
        native.register("screens.list", input: FIAEmpty.self, output: [ScreenDescriptor].self, permission: "screens") { [screens] _ in
            await screens.screens()
        }
        native.register("system.openURL", input: URLInput.self, output: Bool.self, permission: "system") { [system] input in
            guard let url = URL(string: input.url), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else {
                throw FIAError(code: .invalidArgument, component: "system", method: "openURL", message: "URL scheme is not allowed")
            }
            return await system.open(url)
        }
        native.register("system.reveal", input: PathInput.self, output: FIAEmpty.self, permission: "system") { [system] input in
            await system.reveal(URL(fileURLWithPath: input.path))
            return FIAEmpty()
        }
        native.register("globalShortcuts.set", input: ShortcutsInput.self, output: FIAEmpty.self, permission: "globalShortcuts") { [shortcuts] input in
            try await shortcuts.set(input.shortcuts)
            return FIAEmpty()
        }
        native.register("screen.requestAuthorization", input: FIAEmpty.self, output: Bool.self, permission: "screenCapture") { [screenCapture] _ in
            await MainActor.run { screenCapture.requestAuthorization() }
        }
        native.register("screen.captureRegion", input: FIAEmpty.self, output: NativeResourceDescriptor.self, permission: "screenCapture") { [weak self] _ in
            guard let self, let endpoint = await self.endpoint, let origin = URL(string: endpoint.origin) else {
                throw FIAError(code: .capabilityUnavailable, component: "screen", method: "captureRegion", message: "The resource gateway is unavailable")
            }
            let resource = try await self.screenCapture.captureRegion(resources: self.resources, session: endpoint.session, origin: origin)
            return resource.descriptor
        }
        native.register("resources.dispose", input: ResourceID.self, output: FIAEmpty.self) { [weak self] input in
            guard let self, let endpoint = await self.endpoint else { return FIAEmpty() }
            await self.resources.dispose(id: input.id, session: endpoint.session)
            return FIAEmpty()
        }
    }

    private func registerUpdaterService() {
        native.register("updater.check", input: FIAEmpty.self, output: FIAEmpty.self) { [weak self] _ in
            guard let self else { throw CancellationError() }
            try await MainActor.run { try self.updater.checkForUpdates() }
            return FIAEmpty()
        }
    }

    private func waitForDevelopmentServer(path: String) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: path) { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw FIAError(code: .timeout, component: "web", method: "start", message: "Vite did not become ready", recoverable: true)
    }
}

private struct ClipboardText: Codable, Sendable { let text: String }
private struct ResourceID: Codable, Sendable { let id: String }
private struct ApplicationInfo: Codable, Sendable { let name: String; let identifier: String; let version: String; let build: Int }
private struct OpenFilesInput: Codable, Sendable { let multiple: Bool }
private struct SaveFileInput: Codable, Sendable { let suggestedName: String? }
private struct KeyInput: Codable, Sendable { let key: String }
private struct KeyValueInput: Codable, Sendable { let key: String; let value: String }
private struct NotificationInput: Codable, Sendable { let title: String; let body: String }
private struct URLInput: Codable, Sendable { let url: String }
private struct PathInput: Codable, Sendable { let path: String }
private struct ShortcutsInput: Codable, Sendable { let shortcuts: [ShortcutService.Shortcut] }
private struct ShortcutPressed: Codable, Sendable { let id: String }
private struct UpdateStatePayload: Codable, Sendable {
    let state: String
    let message: String?

    init(_ value: UpdateState) {
        switch value {
        case .disabled: state = "disabled"; message = nil
        case .idle: state = "idle"; message = nil
        case .checking: state = "checking"; message = nil
        case .installing: state = "installing"; message = nil
        case let .failed(reason): state = "failed"; message = reason
        }
    }
}
private struct UpdateWillInstall: Encodable, Sendable { let installing = true }

struct RuntimeManifest: Decodable, Sendable {
    struct App: Decodable, Sendable {
        let name: String
        let identifier: String
        let version: String
        let build: Int
        let minimumMacOS: String
        let activationPolicy: String
    }
    struct Web: Decodable, Sendable { let enabled: Bool; let directory: String? }
    struct Backend: Decodable, Sendable {
        let enabled: Bool
        let protocolVersion: Int
        let executable: String?
        let sha256: String?
        let mount: String
    }
    struct StatusItem: Decodable, Sendable { let symbol: String; let tooltip: String }
    struct Updater: Decodable, Sendable { let publicKey: String; let channel: String; let ui: String; let feeds: [String: String] }
    let schema: Int
    let frameworkVersion: String
    let nativeProtocolVersion: Int
    let app: App
    let web: Web
    let backend: Backend
    let statusItem: StatusItem?
    let permissions: [String: Bool]
    let updater: Updater?

    static func load() throws -> RuntimeManifest {
        guard let url = Bundle.main.resourceURL?.appending(path: "fia.runtime.json"),
              FileManager.default.fileExists(atPath: url.path)
        else {
            return RuntimeManifest(
                schema: 1,
                frameworkVersion: FIAVersion.current,
                nativeProtocolVersion: FIAVersion.nativeProtocol,
                app: App(name: ProcessInfo.processInfo.processName, identifier: Bundle.main.bundleIdentifier ?? "dev.fia.app", version: "0.0.0", build: 1, minimumMacOS: "14.0", activationPolicy: "regular"),
                web: Web(enabled: false, directory: nil),
                backend: Backend(enabled: false, protocolVersion: FIAStdioProtocolVersion, executable: nil, sha256: nil, mount: "/api"),
                statusItem: nil,
                permissions: ["application": true, "windows": true],
                updater: nil
            )
        }
        let value = try JSONDecoder().decode(RuntimeManifest.self, from: Data(contentsOf: url))
        guard value.schema == 1, value.frameworkVersion == FIAVersion.current,
              value.nativeProtocolVersion == FIAVersion.nativeProtocol,
              value.backend.protocolVersion == FIAStdioProtocolVersion else {
            throw FIAError(code: .protocolFailure, component: "runtime", method: "load", message: "The bundled FIA runtime manifest is incompatible")
        }
        return value
    }
}
