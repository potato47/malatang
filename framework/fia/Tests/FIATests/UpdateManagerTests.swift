import CryptoKit
import Foundation
import Testing

@testable import FIA

private final class UpdateURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var bodies: [String: Data] = [:]
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let data = Self.bodies[request.url!.absoluteString]
    let response = HTTPURLResponse(
      url: request.url!, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1",
      headerFields: nil)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    if let data { client?.urlProtocol(self, didLoad: data) }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@MainActor @Suite("Update coordinator", .serialized)
struct UpdateManagerTests {
  @Test func downloadsDefersCommitsAndRecoversAFailedActivation() async throws {
    let f = CodeReleaseTests.Fixture()
    defer {
      f.cleanup()
      UpdateURLProtocol.bodies = [:]
    }
    _ = try f.write(1, at: f.factory)
    let candidateRoot = f.root.appending(path: "remote")
    let second = try f.write(2, at: candidateRoot)
    let envelope = try Data(contentsOf: candidateRoot.appending(path: "release.json"))
    UpdateURLProtocol.bodies = ["https://example.com/latest.json": envelope]
    for file in second.files {
      UpdateURLProtocol.bodies[second.baseURL + file.path] = try Data(
        contentsOf: candidateRoot.appending(path: file.path))
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [UpdateURLProtocol.self]
    let network = URLSession(configuration: configuration)
    defer { network.invalidateAndCancel() }
    let store = try f.store()
    let manager = CodeUpdateManager(
      config: UpdateConfiguration(
        url: "https://example.com/latest.json", publicKey: f.publicKey, downloadURL: nil),
      store: store, network: network)
    manager.activate = { _, _, _ in }
    manager.confirmInstallation = { _ in false }
    #expect(try await manager.check().phase == "available")
    #expect(try await manager.download().phase == "downloaded")
    #expect(try await manager.apply().phase == "downloaded")
    #expect(try store.selected().release.build == 1)
    manager.confirmInstallation = { _ in true }
    manager.prepare = { throw UpdateError("update_busy") }
    await #expect(throws: (any Error).self) { try await manager.apply() }
    #expect(manager.state.phase == "downloaded")
    #expect(try store.selected().release.build == 1)
    await manager.checkAndPrompt()
    #expect(manager.state.phase == "downloaded")
    #expect(manager.state.message == "update_busy")
    manager.prepare = nil
    #expect(try await manager.apply().phase == "applying")
    for _ in 0..<100 where manager.state.phase == "applying" {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(manager.state.phase == "current")
    #expect(try store.selected().release.build == 2)

    let third = try f.write(3, at: candidateRoot)
    UpdateURLProtocol.bodies["https://example.com/latest.json"] = try Data(
      contentsOf: candidateRoot.appending(path: "release.json"))
    for file in third.files {
      UpdateURLProtocol.bodies[third.baseURL + file.path] = try Data(
        contentsOf: candidateRoot.appending(path: file.path))
    }
    #expect(try await manager.check().phase == "available")
    _ = try await manager.download()
    var restored: Int?
    manager.activate = { release, _, trial in
      if trial { throw UpdateError("candidate crashed") }
      restored = release.build
    }
    _ = try await manager.apply()
    for _ in 0..<100 where manager.state.phase == "applying" {
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(manager.state.phase == "failed")
    #expect(restored == 2)
    #expect(try store.selected().release.build == 2)
    #expect(store.isFailed(3))
    manager.stop()
  }
  @Test func corruptDownloadAndNetworkFailureLeaveFactoryUntouched() async throws {
    let f = CodeReleaseTests.Fixture()
    defer {
      f.cleanup()
      UpdateURLProtocol.bodies = [:]
    }
    _ = try f.write(1, at: f.factory)
    let remote = f.root.appending(path: "remote")
    let second = try f.write(2, at: remote)
    UpdateURLProtocol.bodies = [
      "https://example.com/latest.json": try Data(
        contentsOf: remote.appending(path: "release.json")),
      second.baseURL + "backend/index.js": Data("corrupt".utf8),
    ]
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [UpdateURLProtocol.self]
    let network = URLSession(configuration: configuration)
    defer { network.invalidateAndCancel() }
    let store = try f.store()
    let manager = CodeUpdateManager(
      config: UpdateConfiguration(
        url: "https://example.com/latest.json", publicKey: f.publicKey, downloadURL: nil),
      store: store, network: network)
    _ = try await manager.check()
    await #expect(throws: (any Error).self) { try await manager.download() }
    #expect(manager.state.phase == "failed")
    #expect(try store.selected().release.build == 1)
    UpdateURLProtocol.bodies = [:]
    await #expect(throws: (any Error).self) { try await manager.check() }
    #expect(try store.selected().release.build == 1)
    manager.stop()
  }
}
