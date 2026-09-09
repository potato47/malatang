import CryptoKit
import Darwin
import Foundation

public struct CodeRelease: Codable, Sendable, Equatable {
  public struct File: Codable, Sendable, Equatable {
    public let path: String
    public let size: Int64
    public let sha256: String
  }
  public let schema: Int
  public let identifier: String
  public let version: String
  public let build: Int
  public let runtimeId: String
  public let baseURL: String
  public let downloadURL: String?
  public let files: [File]

  public static func safePath(_ path: String) -> Bool {
    !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("%")
      && !path.contains(":")
      && !path.contains("?") && !path.contains("#")
      && !path.unicodeScalars.contains { $0.value < 32 }
      && path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
        !$0.isEmpty && !$0.hasPrefix(".")
      }
  }
  public func validate(identifier expected: String) throws {
    guard schema == 1, identifier == expected, build > 0, build <= 9_007_199_254_740_991,
      !version.isEmpty,
      runtimeId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      !files.isEmpty, files.count <= 4096
    else { throw UpdateError("Invalid release metadata") }
    var paths: Set<String> = []
    var bytes: Int64 = 0
    for file in files {
      guard Self.safePath(file.path), paths.insert(file.path.lowercased()).inserted,
        file.size >= 0, file.size <= 268_435_456,
        file.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
        !["node", "dylib", "so", "exe"].contains(
          URL(fileURLWithPath: file.path).pathExtension.lowercased())
      else { throw UpdateError("Unsafe release file: " + file.path) }
      bytes += file.size
    }
    guard bytes <= 536_870_912, paths.contains("backend/index.js"), paths.contains("web/index.html")
    else { throw UpdateError("Incomplete or oversized release") }
  }
  public func verifyFiles(at directory: URL) throws {
    let root = directory.resolvingSymlinksInPath().path + "/"
    for entry in files {
      let url = directory.appending(path: entry.path)
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular,
        url.resolvingSymlinksInPath().path.hasPrefix(root),
        (attributes[.size] as? NSNumber)?.int64Value == entry.size,
        try fileSHA256(url) == entry.sha256
      else { throw UpdateError("Release integrity failed: " + entry.path) }
      let handle = try FileHandle(forReadingFrom: url)
      let magic = try handle.read(upToCount: 4) ?? Data()
      try handle.close()
      if Self.nativeMagic(magic) { throw UpdateError("Native binaries require a full installer") }
    }
  }
  static func nativeMagic(_ data: Data) -> Bool {
    ["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "bebafeca", "7f454c46"].contains(
      data.map { String(format: "%02x", $0) }.joined()) || data.prefix(2) == Data([0x4d, 0x5a])
  }
}
public struct SignedCodeRelease: Codable, Sendable {
  public let payload: String
  public let signature: String
  public func verified(publicKey: String, identifier: String) throws -> CodeRelease {
    guard let key = Data(base64Encoded: publicKey), let data = Data(base64Encoded: payload),
      data.count <= 1_048_576,
      let signature = Data(base64Encoded: signature), signature.count == 64,
      try Curve25519.Signing.PublicKey(rawRepresentation: key).isValidSignature(
        signature, for: data)
    else { throw UpdateError("Invalid update signature") }
    let release = try JSONDecoder().decode(CodeRelease.self, from: data)
    try release.validate(identifier: identifier)
    guard let base = URL(string: release.baseURL), base.scheme == "https", base.host != nil,
      base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
      release.baseURL.hasSuffix("/")
    else { throw UpdateError("Update file baseURL must be an HTTPS directory") }
    if let download = release.downloadURL {
      guard let url = URL(string: download), url.scheme == "https", url.host != nil,
        url.user == nil, url.password == nil
      else { throw UpdateError("Installer URL must be HTTPS") }
    }
    return release
  }
}
public struct UpdateError: Error, LocalizedError, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}
public func fileSHA256(_ url: URL) throws -> String {
  let file = try FileHandle(forReadingFrom: url)
  defer { try? file.close() }
  var digest = SHA256()
  while let data = try file.read(upToCount: 65_536), !data.isEmpty { digest.update(data: data) }
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

/// This journal changes code selection only. Application data is never rolled back.
public final class CodeReleaseStore {
  struct Journal: Codable {
    var runtimeId: String
    var active: Int?
    var previous: Int?
    var pending: Int?
    var failed: [Int] = []
    var highestBuild: Int
  }
  public let directory: URL
  public let factoryDirectory: URL
  public let factory: CodeRelease
  private let publicKey: String?
  private var lockFile: FileHandle?
  private var journal: Journal
  private var journalURL: URL { directory.appending(path: "state.json") }
  public var highestBuild: Int { journal.highestBuild }
  public func isFailed(_ build: Int) -> Bool { journal.failed.contains(build) }
  public func releaseDirectory(_ build: Int) -> URL {
    directory.appending(path: "releases/\(build)", directoryHint: .isDirectory)
  }
  public init(directory: URL, factoryDirectory: URL, publicKey: String?) throws {
    self.directory = directory
    self.factoryDirectory = factoryDirectory
    self.publicKey = publicKey
    factory = try JSONDecoder().decode(
      CodeRelease.self, from: Data(contentsOf: factoryDirectory.appending(path: "manifest.json")))
    try factory.validate(identifier: factory.identifier)
    try factory.verifyFiles(at: factoryDirectory)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    journal = Journal(runtimeId: factory.runtimeId, highestBuild: factory.build)
    let fd = Darwin.open(
      directory.appending(path: "update.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { throw UpdateError("Could not open update lock") }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
      Darwin.close(fd)
      throw UpdateError("This application is already running")
    }
    lockFile = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    if let data = try? Data(contentsOf: directory.appending(path: "state.json")),
      let existing = try? JSONDecoder().decode(Journal.self, from: data),
      existing.runtimeId == factory.runtimeId
    {
      journal = existing
      if let pending = journal.pending {
        journal.failed.append(pending)
        journal.pending = nil
      }
      if let active = journal.active, active <= factory.build {
        journal.active = nil
        journal.previous = nil
      }
      journal.highestBuild = max(journal.highestBuild, factory.build)
    } else {
      journal = Journal(runtimeId: factory.runtimeId, highestBuild: factory.build)
    }
    try persist()
  }
  public func selected() throws -> (release: CodeRelease, directory: URL) {
    if let active = journal.active {
      do { return (try installed(active), releaseDirectory(active)) } catch {
        journal.failed.append(active)
        journal.active = journal.previous
        journal.previous = nil
        try persist()
        if let previous = journal.active, let release = try? installed(previous) {
          return (release, releaseDirectory(previous))
        }
        journal.active = nil
        try persist()
      }
    }
    return (factory, factoryDirectory)
  }
  public func installed(_ build: Int) throws -> CodeRelease {
    guard let publicKey else { throw UpdateError("Updates are disabled") }
    let directory = releaseDirectory(build)
    let envelope = try JSONDecoder().decode(
      SignedCodeRelease.self, from: Data(contentsOf: directory.appending(path: "release.json")))
    let release = try envelope.verified(publicKey: publicKey, identifier: factory.identifier)
    guard release.build == build, release.runtimeId == factory.runtimeId else {
      throw UpdateError("Incompatible installed code")
    }
    try release.verifyFiles(at: directory)
    return release
  }
  public func begin(_ release: CodeRelease) throws {
    guard journal.pending == nil, release.build > journal.highestBuild, !isFailed(release.build),
      release.runtimeId == factory.runtimeId
    else { throw UpdateError("Release cannot be activated") }
    _ = try installed(release.build)
    var next = journal
    next.pending = release.build
    try persist(next)
  }
  public func commit(_ build: Int) throws {
    guard journal.pending == build else { throw UpdateError("No matching update transaction") }
    var next = journal
    next.previous = journal.active
    next.active = build
    next.pending = nil
    next.highestBuild = build
    try persist(next)
    let keep = Set([journal.active, journal.previous].compactMap { $0 })
    if let entries = try? FileManager.default.contentsOfDirectory(
      at: directory.appending(path: "releases"), includingPropertiesForKeys: nil)
    {
      for entry in entries {
        if let storedBuild = Int(entry.lastPathComponent), storedBuild < build,
          !keep.contains(storedBuild)
        {
          try? FileManager.default.removeItem(at: entry)
        }
      }
    }
  }
  public func rollback(_ build: Int) throws {
    var next = journal
    next.pending = nil
    if !next.failed.contains(build) { next.failed.append(build) }
    try persist(next)
  }
  private func persist() throws {
    try persist(journal)
  }
  private func persist(_ next: Journal) throws {
    let temporary = directory.appending(path: ".state-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard
      FileManager.default.createFile(
        atPath: temporary.path, contents: nil, attributes: [.posixPermissions: 0o600])
    else { throw UpdateError("Could not create update journal") }
    let handle = try FileHandle(forWritingTo: temporary)
    do {
      try handle.write(contentsOf: JSONEncoder().encode(next))
      try handle.synchronize()
      try handle.close()
    } catch {
      try? handle.close()
      throw error
    }
    guard Darwin.rename(temporary.path, journalURL.path) == 0 else {
      throw UpdateError("Could not commit update journal")
    }
    journal = next
    // Persist the directory entry as well as the journal contents before reporting success.
    let fd = Darwin.open(directory.path, O_RDONLY)
    if fd >= 0 {
      _ = fsync(fd)
      Darwin.close(fd)
    }
  }
}
