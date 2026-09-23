import AppKit
import CryptoKit
import Darwin
import FIACore
@_exported import FIAMacOS
import Foundation

@MainActor
public final class FIARuntime {
  public let windows = WindowManager()
  public let native = NativeMethodRegistry()
  public let resources: ResourceStore
  public let updater: CodeUpdateManager
  public let clipboard = ClipboardService()
  public let dialogs = DialogService()
  public let notifications = NotificationService()
  public let screens = ScreenService()
  public let screenCapture = ScreenCaptureService()
  public let system = SystemService()
  public let shortcuts = ShortcutService()
  public let keychain: KeychainService
  public private(set) var lifecycle: RuntimeLifecycle = .running
  private let manifest: RuntimeManifest
  private let bundle: Bundle
  private let supportDirectory: URL
  private let store: CodeReleaseStore
  private var activeRelease: CodeRelease
  private var activeDirectory: URL
  private let session = UUID().uuidString + UUID().uuidString
  private let development = ProcessInfo.processInfo.environment["FIA_DEVELOPMENT"] == "1"
  private let developmentOrigin = ProcessInfo.processInfo.environment["FIA_WEB_DEV_URL"].flatMap(
    URL.init(string:))
  private var backend: BackendSupervisor?
  private var backendOrigin: URL?
  private var backendReady = false
  private var backendFailure: String?
  private var frontendReady: Set<String> = []
  private var frontendFailure: String?
  private var port = 0
  private var inspectionTask: Task<Void, Never>?
  private var transitioning = false
  public var onShow: (() -> Void)?
  private var background = false
  private var shutdownTask: Task<ShutdownReport, Never>?
  private var control: URL? {
    ProcessInfo.processInfo.environment["FIA_CONTROL_DIRECTORY"].map { URL(fileURLWithPath: $0) }
  }

  init(
    manifest: RuntimeManifest, bundle: Bundle = .main, supportDirectory: URL? = nil,
    updateNetwork: URLSession = .shared
  ) throws {
    self.manifest = manifest
    self.bundle = bundle
    let support =
      try supportDirectory ?? ProcessInfo.processInfo.environment["FIA_DATA_DIRECTORY"].map {
        URL(fileURLWithPath: $0)
      }
      ?? FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    self.supportDirectory = support
    let appSupport = support.appending(path: manifest.app.identifier, directoryHint: .isDirectory)
    guard let resourcesURL = bundle.resourceURL else {
      throw UpdateError("Missing application resources")
    }
    store = try CodeReleaseStore(
      directory: appSupport.appending(path: "Updates"),
      factoryDirectory: resourcesURL.appending(path: "code"), publicKey: manifest.updates?.publicKey
    )
    guard store.factory.identifier == manifest.app.identifier,
      store.factory.runtimeId == manifest.runtimeId
    else { throw UpdateError("Factory code does not match the installed runtime") }
    let selected = try store.selected()
    activeRelease = selected.release
    activeDirectory = selected.directory
    resources = try ResourceStore()
    keychain = KeychainService(service: manifest.app.identifier)
    updater = CodeUpdateManager(
      config: development ? nil : manifest.updates, store: store, network: updateNetwork)
    native.setPermissions(
      Dictionary(
        uniqueKeysWithValues: [
          "application", "windows", "dialogs", "clipboard", "keychain", "screens", "screenCapture",
          "notifications", "system", "globalShortcuts", "agent",
        ].map { ($0, true) }))
    windows.appName = manifest.app.name
    windows.registerNativeMethods(native)
    windows.onEvent = { [weak self] event in self?.emit("windows.changed", event) }
    windows.onAction = { [weak self] id, item in
      self?.emit("windows.titlebarAction", TitlebarAction(windowId: id, itemId: item))
    }
    windows.onContentFailure = { [weak self] id in self?.frontendFailure = "WebView failed: " + id }
    shortcuts.onPressed = { [weak self] id in
      self?.emit("globalShortcuts.pressed", ShortcutPressed(id: id))
    }
    updater.onState = { [weak self] state in self?.emit("updates.stateChanged", state) }
    updater.activate = { [weak self] release, directory, trial in
      guard let self else { throw CancellationError() }
      try await self.activate(release, directory: directory, trial: trial)
    }
    updater.prepare = { [weak self] in try await self?.updateGate("prepare") }
    updater.resume = { [weak self] in try? await self?.updateGate("resume") }
    updater.committed = { [weak self] in
      guard let self else { return }
      try self.publishAgentAssets()
      try await self.updateGate("resume")
    }
    updater.allowsAutomaticPrompts = { [weak self] in self?.windows.states.contains(where: { $0.orderedIn }) ?? false }
    registerServices()
    registerRuntimeMethods()
  }
  func start(automaticUpdates: Bool = true, background: Bool = false) async throws {
    self.background = background
    try publishAgentAssets()
    _ = try windows.create(WindowOptions(id: "main"))
    launchBackend()
    try await waitForBackend()
    if let readyFile = ProcessInfo.processInfo.environment["FIA_DEV_READY_FILE"] {
      let deadline = Date().addingTimeInterval(15)
      while !FileManager.default.fileExists(atPath: readyFile) {
        if Date() >= deadline { throw UpdateError("Vite did not become ready") }
        try await Task.sleep(for: .milliseconds(50))
      }
    }
    connectWindows()
    try publishAgentAssets()
    if !background { try windows.restoreMainWindow() }
    startInspection()
    if automaticUpdates { updater.startAutomaticChecks() }
  }
  private func launchBackend(trial: Bool = false) {
    backendReady = false
    backendFailure = nil
    frontendReady.removeAll()
    frontendFailure = nil
    let entry =
      development
      ? (manifest.developmentEntry ?? activeDirectory.appending(path: "backend/index.js").path)
      : activeDirectory.appending(path: "backend/index.js").path
    let configuration = FIABunConfiguration(
      development: development, appName: manifest.app.name, appIdentifier: manifest.app.identifier,
      executable: bundle.bundleURL.appending(path: "Contents/Helpers/bun").path,
      arguments: ["--no-env-file", entry], sha256: manifest.bunSHA256,
      sessionSecret: session, bundlePath: bundle.bundleURL.resolvingSymlinksInPath().path, runtimeId: manifest.runtimeId, agentCommand: manifest.agent?.command, updating: trial, webRoot: activeDirectory.appending(path: "web").path,
      resourceDirectory: resources.directory.path,
      developmentOrigin: developmentOrigin?.absoluteString, version: activeRelease.version,
      build: activeRelease.build, preferredPort: port, automaticallyRestart: !trial)
    do {
      let backend = try BackendSupervisor(
        configuration: configuration, applicationSupportDirectory: supportDirectory
      ) { [weak self] method, params in
        guard let self else { throw CancellationError() }
        let input = try JSONSerialization.data(withJSONObject: params, options: .fragmentsAllowed)
        switch await self.native.dispatch(method: method, params: input) {
        case .success(let data):
          return try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
        case .failure(let error): throw error
        }
      } onState: { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready(let port):
          self.port = port
          self.backendOrigin = URL(string: "http://127.0.0.1:\(port)")!
          self.backendReady = true
          if !self.transitioning { self.connectWindows() }
        case .starting, .restarting:
          self.backendReady = false
          self.frontendReady.removeAll()
          self.frontendFailure = nil
          self.windows.suspend()
          self.native.cancelActive()
          self.shortcuts.clear()
          Task { await self.resources.cleanupAll() }
        case .failed(let reason):
          self.backendReady = false
          self.backendFailure = reason
          self.windows.suspend()
        case .stopping, .stopped: self.backendReady = false
        }
      }
      backend.onListening = { [weak self] port in
        guard let self else { return }
        self.port = port
        self.backendOrigin = URL(string: "http://127.0.0.1:\(port)")!
        if let control = self.control {
          let endpoint: [String: Any] = [
            "origin": self.backendOrigin!.absoluteString,
            "generation": self.backend?.generationID ?? "",
          ]
          if let data = try? JSONSerialization.data(withJSONObject: endpoint) {
            try? data.write(to: control.appending(path: "backend.json"), options: .atomic)
          }
        }
      }
      self.backend = backend
      backend.start()
    } catch { backendFailure = error.localizedDescription }
  }
  private func connectWindows() {
    guard backendReady, let origin = developmentOrigin ?? backendOrigin,
      let generation = backend?.generationID
    else { return }
    if let ready = ProcessInfo.processInfo.environment["FIA_DEV_READY_FILE"],
      !FileManager.default.fileExists(atPath: ready)
    {
      return
    }
    let secret = session
    windows.connect { id, route in
      let nonce = UUID().uuidString
      let content = [id, route, nonce, generation].joined(separator: "\n")
      let proof = HMAC<SHA256>.authenticationCode(
        for: Data(content.utf8), using: SymmetricKey(data: Data(secret.utf8))
      ).map { String(format: "%02x", $0) }.joined()
      var components = URLComponents(
        url: origin.appending(path: "_fia/bootstrap"), resolvingAgainstBaseURL: false)!
      components.queryItems = [
        URLQueryItem(name: "window", value: id), URLQueryItem(name: "route", value: route),
        URLQueryItem(name: "nonce", value: nonce), URLQueryItem(name: "proof", value: proof),
      ]
      return components.url!
    }
  }
  private func waitForBackend(deadline: Date = Date().addingTimeInterval(15)) async throws {
    while !backendReady {
      try Task.checkCancellation()
      guard lifecycle == .running else { throw CancellationError() }
      if let backendFailure { throw UpdateError(backendFailure) }
      if Date() >= deadline { throw UpdateError("Backend readiness timed out") }
      try await Task.sleep(for: .milliseconds(50))
    }
  }
  private func activate(_ release: CodeRelease, directory: URL, trial: Bool) async throws {
    guard lifecycle == .running, !transitioning else {
      throw UpdateError("Runtime cannot reload now")
    }
    transitioning = true
    defer { transitioning = false }
    windows.suspend()
    try await backend?.stop()
    native.cancelActive()
    shortcuts.clear()
    await resources.cleanupAll()
    guard lifecycle == .running else { throw CancellationError() }
    activeRelease = release
    activeDirectory = directory
    launchBackend(trial: trial)
    let deadline = Date().addingTimeInterval(15)
    try await waitForBackend(deadline: deadline)
    guard let origin = backendOrigin else { throw UpdateError("Backend endpoint missing") }
    guard Date() < deadline else { throw UpdateError("Backend readiness timed out") }
    var request = URLRequest(url: origin.appending(path: "_fia/health"))
    request.setValue(session, forHTTPHeaderField: "x-fia-session")
    request.timeoutInterval = min(3, deadline.timeIntervalSinceNow)
    let (_, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw UpdateError("Backend health check failed")
    }
    connectWindows()
    if trial {
      if windows.openIDs.isEmpty { try windows.prepareHiddenMainWindow(); connectWindows() }
      while !windows.openIDs.isSubset(of: frontendReady) {
        try Task.checkCancellation()
        if !backendReady || frontendFailure != nil || Date() >= deadline {
          throw UpdateError(frontendFailure ?? "Frontend readiness timed out")
        }
        try await Task.sleep(for: .milliseconds(50))
      }
      let probation = Date().addingTimeInterval(30)
      while Date() < probation {
        try Task.checkCancellation()
        if !backendReady || backendFailure != nil || frontendFailure != nil {
          throw UpdateError(frontendFailure ?? "Candidate backend failed during observation")
        }
        try await Task.sleep(for: .milliseconds(100))
      }
      backend?.allowsAutomaticRestart = true
    } else {
      try publishAgentAssets()
      try await updateGate("resume")
    }
  }
  func presentMainWindow() throws { background = false; try windows.restoreMainWindow() }
  func manageCLI(_ command: String) async throws -> AgentCLIStatus {
    try await AgentCLI.manage(bundleURL: bundle.bundleURL, support: supportDirectory.appending(path: manifest.app.identifier), command: command)
  }
  private func publishAgentAssets() throws {
    guard manifest.agent != nil else { return }
    let source = activeDirectory.appending(path: "agent")
    guard FileManager.default.fileExists(atPath: source.path) else { throw UpdateError("Agent assets are missing") }
    let directory = supportDirectory.appending(path: manifest.app.identifier + "/Agent")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let temporary = directory.appending(path: "current-" + UUID().uuidString)
    try FileManager.default.createSymbolicLink(at: temporary, withDestinationURL: source)
    let target = directory.appending(path: "current")
    guard Darwin.rename(temporary.path, target.path) == 0 else { try? FileManager.default.removeItem(at: temporary); throw UpdateError("Could not publish agent assets") }
  }
  private func updateGate(_ action: String) async throws {
    guard let origin = backendOrigin else { throw UpdateError("Backend is unavailable") }
    var request = URLRequest(url: origin.appending(path: "_fia/update/" + action))
    request.httpMethod = "POST"; request.setValue(session, forHTTPHeaderField: "x-fia-session"); request.timeoutInterval = 5
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      struct Failure: Decodable { struct Detail: Decodable { let code: String; let message: String }; let error: Detail }
      if let failure = try? JSONDecoder().decode(Failure.self, from: data) {
        throw FIAError(code: FIAErrorCode(rawValue: failure.error.code), component: "updates", message: failure.error.message, recoverable: true)
      }
      throw UpdateError(String(decoding: data, as: UTF8.self))
    }
  }
  private func emit<Value: Encodable>(_ event: String, _ value: Value) {
    if let data = try? JSONEncoder().encode(value),
      let object = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
    {
      backend?.sendEvent(event, payload: object)
    }
  }
  private func startInspection() {
    guard let control else { return }
    inspectionTask = Task { @MainActor [weak self] in
      while !Task.isCancelled, let self, self.lifecycle == .running {
        let snapshot: [String: Any] = [
          "schemaVersion": 1, "pid": ProcessInfo.processInfo.processIdentifier,
          "lifecycle": self.lifecycle.rawValue,
          "backend": self.backendReady
            ? "ready" : (self.backendFailure == nil ? "starting" : "failed"),
          "build": self.activeRelease.build,
          "windows": self.windows.registeredIDs, "visibleWindows": self.windows.states.filter { $0.orderedIn }.map(\.id), "background": self.background, "frontendsReady": self.frontendReady.sorted(),
          "methods": self.native.methods,
          "processGroups": [self.backend?.processIdentifier].compactMap { $0 },
        ]
        if let data = try? JSONSerialization.data(withJSONObject: snapshot) {
          try? data.write(to: control.appending(path: "ready.json"), options: .atomic)
        }
        if FileManager.default.fileExists(atPath: control.appending(path: "quit").path) {
          FIAApplication.requestQuit()
          return
        }
        if self.development, !self.transitioning,
          FileManager.default.fileExists(atPath: control.appending(path: "reload").path)
        {
          try? FileManager.default.removeItem(at: control.appending(path: "reload"))
          do {
            try await self.activate(
              self.activeRelease, directory: self.activeDirectory, trial: false)
          } catch { fputs("FIA reload: " + error.localizedDescription + "\n", stderr) }
        }
        try? await Task.sleep(for: .milliseconds(100))
      }
    }
  }
  func stop() async -> ShutdownReport {
    if let shutdownTask { return await shutdownTask.value }
    lifecycle = .shuttingDown
    updater.stop()
    windows.beginShutdown()
    native.beginShutdown()
    native.cancelActive()
    inspectionTask?.cancel()
    let task = Task { @MainActor in
      do {
        try await self.backend?.stop()
        self.shortcuts.clear()
        await self.resources.cleanupAll()
        self.lifecycle = .stopped
        return ShutdownReport(reason: .quit, issues: [], completed: true)
      } catch {
        return ShutdownReport(
          reason: .quit, issues: [ShutdownIssue(name: "Bun", message: error.localizedDescription)],
          completed: false)
      }
    }
    shutdownTask = task
    let report = await task.value
    if !report.completed { shutdownTask = nil }
    return report
  }
  private func registerRuntimeMethods() {
    native.register("native.capabilities", input: FIAEmpty.self, output: Capabilities.self) {
      [weak self] _ in
      await MainActor.run {
        Capabilities(
          protocolVersion: 1,
          capabilities: [
            "native": true, "windows": true, "resources": true,
            "updates": self?.updater.isEnabled ?? false,
          ])
      }
    }
    native.register("runtime.frontendReady", input: FrontendReady.self, output: FIAEmpty.self) {
      [weak self] input in
      try await MainActor.run {
        guard let self, input.generation == self.backend?.generationID,
          self.windows.openIDs.contains(input.windowId)
        else { throw UpdateError("Stale frontend generation") }
        self.frontendReady.insert(input.windowId)
        return FIAEmpty()
      }
    }
    native.register("resources.resolve", input: ResourceID.self, output: ResourceFile.self) {
      [weak self] input in
      guard let self,
        let resource = await self.resources.resource(id: input.id, session: self.session)
      else { throw UpdateError("Resource not found") }
      return ResourceFile(path: resource.fileURL.path, contentType: resource.descriptor.contentType)
    }
    native.register("updates.state", input: FIAEmpty.self, output: CodeUpdateState.self) {
      [updater] _ in await updater.state
    }
    native.register("updates.check", input: FIAEmpty.self, output: CodeUpdateState.self) {
      [updater] _ in try await updater.check()
    }
    native.register("updates.download", input: FIAEmpty.self, output: CodeUpdateState.self) {
      [updater] _ in try await updater.download()
    }
    native.register("updates.apply", input: FIAEmpty.self, output: CodeUpdateState.self) {
      [updater] _ in try await updater.apply()
    }
  }
  private func registerServices() {
    native.register("application.show", input: FIAEmpty.self, output: FIAEmpty.self, permission: "application") { [weak self] _ in
      try await MainActor.run {
        guard let self else { throw CancellationError() }
        self.background = false
        if let show = self.onShow { show() } else { try self.windows.restoreMainWindow() }
        return FIAEmpty()
      }
    }
    for (method, command) in [("agent.installCLI", "install"), ("agent.status", "installation-status"), ("agent.uninstallCLI", "uninstall")] {
      native.register(method, input: FIAEmpty.self, output: AgentCLIStatus.self, permission: "agent") { [weak self] _ in
        guard let self else { throw CancellationError() }
        return try await self.manageCLI(command)
      }
    }
    native.register(
      "application.info", input: FIAEmpty.self, output: ApplicationInfo.self,
      permission: "application"
    ) { [weak self] _ in
      try await MainActor.run {
        guard let self else { throw CancellationError() }
        return ApplicationInfo(
          name: self.manifest.app.name, identifier: self.manifest.app.identifier,
          version: self.activeRelease.version, build: self.activeRelease.build)
      }
    }
    native.register(
      "application.quit", input: FIAEmpty.self, output: FIAEmpty.self, permission: "application"
    ) { _ in
      Task { @MainActor in
        // Send the native and CLI acknowledgements before shutdown cancels transports.
        try? await Task.sleep(for: .milliseconds(100))
        FIAApplication.requestQuit()
      }
      return FIAEmpty()
    }
    native.register(
      "clipboard.readText", input: FIAEmpty.self, output: Optional<String>.self,
      permission: "clipboard"
    ) { [clipboard] _ in
      await MainActor.run { clipboard.readText() }
    }
    native.register(
      "clipboard.writeText", input: ClipboardText.self, output: FIAEmpty.self,
      permission: "clipboard"
    ) { [clipboard] input in
      let success = await MainActor.run { clipboard.writeText(input.text) }
      if !success {
        throw FIAError(
          code: .nativeFailure, component: "clipboard", method: "writeText",
          message: "macOS rejected the clipboard write")
      }
      return FIAEmpty()
    }
    native.register(
      "dialogs.openFiles", input: OpenFilesInput.self, output: Optional<[String]>.self,
      permission: "dialogs"
    ) { [dialogs] input in
      await dialogs.openFiles(allowsMultipleSelection: input.multiple)?.map(\.path)
    }
    native.register(
      "dialogs.saveFile", input: SaveFileInput.self, output: Optional<String>.self,
      permission: "dialogs"
    ) { [dialogs] input in
      await dialogs.saveFile(suggestedName: input.suggestedName)?.path
    }
    native.register(
      "keychain.get", input: KeyInput.self, output: Optional<String>.self, permission: "keychain"
    ) { [keychain] input in
      try keychain.value(for: input.key)
    }
    native.register(
      "keychain.set", input: KeyValueInput.self, output: FIAEmpty.self, permission: "keychain"
    ) { [keychain] input in
      try keychain.set(input.value, for: input.key)
      return FIAEmpty()
    }
    native.register(
      "keychain.delete", input: KeyInput.self, output: Bool.self, permission: "keychain"
    ) { [keychain] input in
      try keychain.delete(input.key)
    }
    native.register(
      "notifications.requestAuthorization", input: FIAEmpty.self, output: Bool.self,
      permission: "notifications"
    ) { [notifications] _ in
      try await notifications.requestAuthorization()
    }
    native.register(
      "notifications.deliver", input: NotificationInput.self, output: FIAEmpty.self,
      permission: "notifications"
    ) { [notifications] input in
      try await notifications.deliver(title: input.title, body: input.body)
      return FIAEmpty()
    }
    native.register(
      "screens.list", input: FIAEmpty.self, output: [ScreenDescriptor].self, permission: "screens"
    ) { [screens] _ in
      await screens.screens()
    }
    native.register("system.openURL", input: URLInput.self, output: Bool.self, permission: "system")
    { [system] input in
      guard let url = URL(string: input.url),
        ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
      else {
        throw FIAError(
          code: .invalidArgument, component: "system", method: "openURL",
          message: "URL scheme is not allowed")
      }
      return await system.open(url)
    }
    native.register(
      "system.reveal", input: PathInput.self, output: FIAEmpty.self, permission: "system"
    ) { [system] input in
      await system.reveal(URL(fileURLWithPath: input.path))
      return FIAEmpty()
    }
    native.register(
      "globalShortcuts.set", input: ShortcutsInput.self, output: FIAEmpty.self,
      permission: "globalShortcuts"
    ) { [shortcuts] input in
      try await shortcuts.set(
        input.shortcuts.map {
          ShortcutService.Shortcut(id: $0.id, key: $0.key, modifiers: $0.modifiers)
        })
      return FIAEmpty()
    }
    native.register(
      "screen.requestAuthorization", input: FIAEmpty.self, output: Bool.self,
      permission: "screenCapture"
    ) { [screenCapture] _ in
      await MainActor.run { screenCapture.requestAuthorization() }
    }
    native.register(
      "screen.captureRegion", input: FIAEmpty.self, output: NativeResourceDescriptor.self,
      permission: "screenCapture"
    ) { [weak self] _ in
      guard let self, let origin = await self.backendOrigin else {
        throw FIAError(
          code: .capabilityUnavailable, component: "screen", method: "captureRegion",
          message: "The resource gateway is unavailable")
      }
      let resource = try await self.screenCapture.captureRegion(
        resources: self.resources, session: self.session, origin: origin)
      return resource.descriptor
    }
    native.register("resources.dispose", input: ResourceID.self, output: FIAEmpty.self) {
      [weak self] input in
      guard let self else { return FIAEmpty() }
      await self.resources.dispose(id: input.id, session: self.session)
      return FIAEmpty()
    }
  }

}
private typealias ClipboardText = BuiltinClipboardText
private typealias ResourceID = BuiltinResourceID
private typealias ApplicationInfo = BuiltinApplicationInfo
private typealias OpenFilesInput = BuiltinOpenFilesInput
private typealias SaveFileInput = BuiltinSaveFileInput
private typealias KeyInput = BuiltinKeyInput
private typealias KeyValueInput = BuiltinKeyValueInput
private typealias NotificationInput = BuiltinNotificationInput
private typealias URLInput = BuiltinURLInput
private typealias PathInput = BuiltinPathInput
private typealias ShortcutsInput = BuiltinShortcutsInput
private struct ShortcutPressed: Codable, Sendable { let id: String }

private struct TitlebarAction: Encodable {
  let windowId: String
  let itemId: String
}
private struct FrontendReady: Codable, Sendable {
  let windowId: String
  let generation: String
}
private struct ResourceFile: Codable, Sendable {
  let path: String
  let contentType: String
}
private struct Capabilities: Encodable, Sendable {
  let protocolVersion: Int
  let capabilities: [String: Bool]
}
struct RuntimeManifest: Codable, Sendable {
  struct App: Codable, Sendable {
    let name: String
    let identifier: String
    let version: String
    let build: Int
  }
  struct StatusItem: Codable, Sendable {
    let symbol: String
    let tooltip: String?
  }
  let schema: Int
  let frameworkVersion: String
  let app: App
  let bunSHA256: String
  let runtimeId: String
  let developmentEntry: String?
  var agent: AgentConfiguration? = nil
  let statusItem: StatusItem?
  let updates: UpdateConfiguration?
  static func load() throws -> RuntimeManifest {
    guard let path = Bundle.main.resourceURL?.appending(path: "fia.runtime.json") else {
      throw UpdateError("FIA must run from an application bundle")
    }
    let value = try JSONDecoder().decode(Self.self, from: Data(contentsOf: path))
    guard value.schema == 4, value.agent != nil, value.frameworkVersion == FIAVersion.current else {
      throw UpdateError("Incompatible FIA runtime manifest")
    }
    return value
  }
}
