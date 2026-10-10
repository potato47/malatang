import AppKit
import CryptoKit
import Foundation

public struct CodeUpdateState: Codable, Sendable {
  public var phase: String
  public var version: String?
  public var build: Int?
  public var message: String?
  public var downloadURL: String?
}
public struct UpdateConfiguration: Codable, Sendable {
  public let url: String
  public let publicKey: String
  public let downloadURL: String?
}

@MainActor
public final class CodeUpdateManager {
  public private(set) var state = CodeUpdateState(phase: "disabled")
  public var onState: ((CodeUpdateState) -> Void)?
  public var activate: ((CodeRelease, URL, Bool) async throws -> Void)?
  public var prepare: (() async throws -> Void)?
  public var resume: (() async -> Void)?
  public var committed: (() async throws -> Void)?
  public var allowsAutomaticPrompts: () -> Bool = { true }
  private let config: UpdateConfiguration?
  private let store: CodeReleaseStore
  private var envelope: SignedCodeRelease?
  private var candidate: CodeRelease?
  private var busy = false
  private var periodic: Task<Void, Never>?
  private var applying: Task<Void, Never>?
  private var stopped = false
  private let network: URLSession
  var confirmInstallation: (CodeRelease) -> Bool = { candidate in
    let alert = NSAlert()
    alert.messageText = "Update to " + candidate.version + "?"
    alert.informativeText = "The application will reload. Save your work before updating."
    alert.addButton(withTitle: "Update Now")
    alert.addButton(withTitle: "Later")
    return alert.runModal() == .alertFirstButtonReturn
  }
  public var isEnabled: Bool { config != nil }
  public init(config: UpdateConfiguration?, store: CodeReleaseStore, network: URLSession = .shared)
  {
    self.config = config
    self.store = store
    self.network = network
    state.phase = config == nil ? "disabled" : "idle"
  }
  public func startAutomaticChecks() {
    guard config != nil else { return }
    periodic = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        await self?.checkAndPrompt(allowPrompt: self?.allowsAutomaticPrompts() ?? false)
        do { try await Task.sleep(for: .seconds(86_400)) } catch { return }
      }
    }
  }
  public func stop() {
    stopped = true
    periodic?.cancel()
    applying?.cancel()
  }
  public func checkAndPrompt(allowPrompt: Bool = true) async {
    do {
      _ = try await check()
      if state.phase == "available" { _ = try await download() }
      if !allowPrompt { return }
      if state.phase == "downloaded" { _ = try await apply() }
      if state.phase == "requiresInstall" {
        let alert = NSAlert()
        alert.messageText = "A new application installer is required"
        alert.informativeText =
          "This update includes changes to the native runtime. Download and install the new application."
        if state.downloadURL != nil { alert.addButton(withTitle: "Download App") }
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn, let link = state.downloadURL,
          let url = URL(string: link)
        {
          NSWorkspace.shared.open(url)
        }
      }
    } catch {
      // A preflight refusal keeps the verified candidate available for a later attempt.
      transition(state.phase == "downloaded" ? "downloaded" : "failed", message: error.localizedDescription)
    }
  }
  @discardableResult public func check() async throws -> CodeUpdateState {
    guard let config else { return state }
    guard !busy, applying == nil, !stopped else {
      throw UpdateError("An update operation is already running")
    }
    busy = true
    defer { busy = false }
    transition("checking")
    do {
      var request = URLRequest(url: URL(string: config.url)!)
      request.cachePolicy = .reloadIgnoringLocalCacheData
      request.timeoutInterval = 60
      let (bytes, response) = try await network.bytes(for: request)
      try validateResponse(response, source: request.url!)
      var data = Data()
      for try await byte in bytes {
        data.append(byte)
        if data.count > 2_097_152 { throw UpdateError("Update manifest is too large") }
      }
      let signed = try JSONDecoder().decode(SignedCodeRelease.self, from: data)
      let release = try signed.verified(
        publicKey: config.publicKey, identifier: store.factory.identifier)
      envelope = signed
      candidate = release
      if release.build <= store.highestBuild || store.isFailed(release.build) {
        transition("current")
        return state
      }
      if release.runtimeId != store.factory.runtimeId {
        transition("requiresInstall")
        return state
      }
      transition((try? store.installed(release.build)) != nil ? "downloaded" : "available")
      return state
    } catch {
      transition("failed", message: error.localizedDescription)
      throw error
    }
  }
  @discardableResult public func download() async throws -> CodeUpdateState {
    guard !busy, applying == nil, !stopped, let candidate, let envelope, let config,
      candidate.runtimeId == store.factory.runtimeId, candidate.build > store.highestBuild,
      !store.isFailed(candidate.build)
    else { throw UpdateError("No compatible update is available") }
    busy = true
    defer { busy = false }
    if (try? store.installed(candidate.build)) != nil {
      transition("downloaded")
      return state
    }
    transition("downloading")
    let temporary = store.directory.appending(
      path: "staging-" + UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: temporary, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temporary) }
    do {
      for file in candidate.files {
        try Task.checkCancellation()
        let url = URL(string: candidate.baseURL)!.appending(path: file.path)
        var request = URLRequest(url: url)
        request.timeoutInterval = 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (bytes, response) = try await network.bytes(for: request)
        try validateResponse(response, source: url)
        let target = temporary.appending(path: file.path)
        try FileManager.default.createDirectory(
          at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard
          FileManager.default.createFile(
            atPath: target.path, contents: nil, attributes: [.posixPermissions: 0o600])
        else { throw UpdateError("Could not create update file") }
        let handle = try FileHandle(forWritingTo: target)
        do {
          var count: Int64 = 0
          var buffer = Data()
          var hash = SHA256()
          for try await byte in bytes {
            count += 1
            if count > file.size { throw UpdateError("Downloaded file exceeds declared size") }
            buffer.append(byte)
            if buffer.count >= 65_536 {
              hash.update(data: buffer)
              try handle.write(contentsOf: buffer)
              buffer.removeAll(keepingCapacity: true)
            }
          }
          hash.update(data: buffer)
          try handle.write(contentsOf: buffer)
          try handle.synchronize()
          try handle.close()
          guard count == file.size,
            hash.finalize().map({ String(format: "%02x", $0) }).joined() == file.sha256
          else { throw UpdateError("Downloaded file checksum mismatch") }
        } catch {
          try? handle.close()
          throw error
        }
      }
      _ = try envelope.verified(publicKey: config.publicKey, identifier: store.factory.identifier)
      try candidate.verifyFiles(at: temporary)
      try JSONEncoder().encode(envelope).write(
        to: temporary.appending(path: "release.json"), options: .atomic)
      let destination = store.releaseDirectory(candidate.build)
      try FileManager.default.createDirectory(
        at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.moveItem(at: temporary, to: destination)
      transition("downloaded")
      return state
    } catch {
      transition("failed", message: error.localizedDescription)
      throw error
    }
  }
  @discardableResult public func apply() async throws -> CodeUpdateState {
    guard state.phase == "downloaded", !busy, applying == nil, !stopped, let candidate, let activate
    else { throw UpdateError("No downloaded update is ready") }
    guard confirmInstallation(candidate) else { return state }
    busy = true
    do { try await prepare?(); try store.begin(candidate) }
    catch { busy = false; await resume?(); throw error }
    busy = false
    transition("applying")
    applying = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.applying = nil }
      do {
        // Let the caller receive the acknowledgement before closing its WebSocket.
        try await Task.sleep(for: .milliseconds(100))
        try await activate(candidate, self.store.releaseDirectory(candidate.build), true)
        try Task.checkCancellation()
        try self.store.commit(candidate.build)
        try await self.committed?()
        self.transition("current")
      } catch {
        do { try self.store.rollback(candidate.build) } catch {
          self.transition("failed", message: error.localizedDescription)
          return
        }
        if !self.stopped {
          do {
            let previous = try self.store.selected()
            try await activate(previous.release, previous.directory, false)
          } catch {
            self.transition("failed", message: "Rollback failed: " + error.localizedDescription)
            return
          }
        }
        self.transition("failed", message: "Update rolled back: " + error.localizedDescription)
      }
    }
    return state
  }
  private func transition(_ phase: String, message: String? = nil) {
    state = CodeUpdateState(
      phase: phase, version: candidate?.version, build: candidate?.build, message: message,
      downloadURL: candidate?.downloadURL ?? config?.downloadURL)
    onState?(state)
  }
  private func validateResponse(_ response: URLResponse, source: URL) throws {
    guard let http = response as? HTTPURLResponse, http.statusCode == 200, let final = http.url,
      final.scheme == "https", final.host == source.host, final.port == source.port
    else { throw UpdateError("Update server returned an invalid response or redirect") }
  }
}
