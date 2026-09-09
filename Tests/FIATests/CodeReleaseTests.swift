import CryptoKit
import Foundation
import Testing

@testable import FIA

@Suite("Signed code releases")
struct CodeReleaseTests {
  struct Fixture {
    let root = FileManager.default.temporaryDirectory.appending(
      path: "fia-updates-" + UUID().uuidString)
    let key = Curve25519.Signing.PrivateKey()
    var publicKey: String { key.publicKey.rawRepresentation.base64EncodedString() }
    var factory: URL { root.appending(path: "factory") }
    var updates: URL { root.appending(path: "Updates") }
    func write(
      _ build: Int, at directory: URL, runtime: String = String(repeating: "a", count: 64),
      backend: String? = nil, frontend: String? = nil
    ) throws -> CodeRelease {
      var files: [CodeRelease.File] = []
      for path in ["backend/index.js", "web/index.html"] {
        let file = directory.appending(path: path)
        try FileManager.default.createDirectory(
          at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let content = path == "backend/index.js" ? backend : frontend
        let data = Data((content ?? "version \(build): \(path)").utf8)
        try data.write(to: file)
        files.append(
          CodeRelease.File(path: path, size: Int64(data.count), sha256: try fileSHA256(file)))
      }
      let release = CodeRelease(
        schema: 1, identifier: "com.example.updates", version: "1.\(build).0", build: build,
        runtimeId: runtime,
        baseURL: "https://example.com/releases/\(build)/", downloadURL: nil, files: files)
      let data = try JSONEncoder().encode(release)
      try data.write(to: directory.appending(path: "manifest.json"))
      let signed = SignedCodeRelease(
        payload: data.base64EncodedString(),
        signature: try key.signature(for: data).base64EncodedString())
      try JSONEncoder().encode(signed).write(to: directory.appending(path: "release.json"))
      return release
    }
    func store() throws -> CodeReleaseStore {
      try CodeReleaseStore(directory: updates, factoryDirectory: factory, publicKey: publicKey)
    }
    func cleanup() { try? FileManager.default.removeItem(at: root) }
  }
  @Test func verifiesSignatureHashAndCompatibility() throws {
    let f = Fixture()
    defer { f.cleanup() }
    _ = try f.write(1, at: f.factory)
    let directory = f.updates.appending(path: "releases/2")
    let release = try f.write(2, at: directory)
    let envelope = try JSONDecoder().decode(
      SignedCodeRelease.self, from: Data(contentsOf: directory.appending(path: "release.json")))
    #expect(
      try envelope.verified(publicKey: f.publicKey, identifier: release.identifier) == release)
    #expect(throws: (any Error).self) {
      try envelope.verified(
        publicKey: Curve25519.Signing.PrivateKey().publicKey.rawRepresentation
          .base64EncodedString(), identifier: release.identifier)
    }
    #expect(throws: (any Error).self) {
      try envelope.verified(publicKey: f.publicKey, identifier: "com.wrong.app")
    }
    try Data("tampered".utf8).write(to: directory.appending(path: "backend/index.js"))
    #expect(throws: (any Error).self) { try release.verifyFiles(at: directory) }
  }
  @Test func interruptedTrialRecoversAndCannotLoopOnBadVersion() throws {
    let f = Fixture()
    defer { f.cleanup() }
    _ = try f.write(1, at: f.factory)
    let second = try f.write(2, at: f.updates.appending(path: "releases/2"))
    var store: CodeReleaseStore? = try f.store()
    try store!.begin(second)
    #expect(try store!.selected().release.build == 1)
    store = nil
    let reopened = try f.store()
    #expect(try reopened.selected().release.build == 1)
    #expect(reopened.isFailed(2))
    #expect(throws: (any Error).self) { try reopened.begin(second) }
  }
  @Test func commitRollbackAndTamperedActiveUsePreviousCodeWithoutTouchingData() throws {
    let f = Fixture()
    defer { f.cleanup() }
    _ = try f.write(1, at: f.factory)
    let second = try f.write(2, at: f.updates.appending(path: "releases/2"))
    let third = try f.write(3, at: f.updates.appending(path: "releases/3"))
    let dataFile = f.root.appending(path: "database.sqlite")
    try Data("user data".utf8).write(to: dataFile)
    let store = try f.store()
    try store.begin(second)
    try store.commit(2)
    #expect(try store.selected().release.build == 2)
    try store.begin(third)
    try store.rollback(3)
    #expect(try store.selected().release.build == 2)
    #expect(store.isFailed(3))
    #expect(throws: (any Error).self) { try store.begin(second) }
    try Data("broken".utf8).write(to: f.updates.appending(path: "releases/2/web/index.html"))
    #expect(try store.selected().release.build == 1)
    #expect(try String(contentsOf: dataFile, encoding: .utf8) == "user data")
  }
  @Test func newRuntimeCannotUseAnOldRuntimeCodePackage() throws {
    let f = Fixture()
    defer { f.cleanup() }
    _ = try f.write(1, at: f.factory)
    let wrong = try f.write(
      2, at: f.updates.appending(path: "releases/2"), runtime: String(repeating: "b", count: 64))
    let store = try f.store()
    #expect(throws: (any Error).self) { try store.begin(wrong) }
  }
  @Test func rejectsTraversalSymlinksAndDisguisedExecutables() throws {
    for path in [
      "../escape", "/absolute", "a//b", "a/./b", "a/../b", "a\\b", "%2e%2e/file", ".hidden",
      "a?query",
    ] {
      #expect(!CodeRelease.safePath(path))
    }
    #expect(CodeRelease.safePath("backend/assets/model.wasm"))
    let f = Fixture()
    defer { f.cleanup() }
    let release = try f.write(1, at: f.factory)
    let file = f.factory.appending(path: "backend/index.js")
    try FileManager.default.removeItem(at: file)
    try FileManager.default.createSymbolicLink(
      at: file, withDestinationURL: f.factory.appending(path: "web/index.html"))
    #expect(throws: (any Error).self) { try release.verifyFiles(at: f.factory) }
    #expect(CodeRelease.nativeMagic(Data([0xcf, 0xfa, 0xed, 0xfe])))
  }
}
