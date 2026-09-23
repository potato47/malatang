import AppKit
import FIACore
import Foundation
import Testing

@testable import FIA

private final class RuntimeUpdateURLProtocol: URLProtocol, @unchecked Sendable {
  nonisolated(unsafe) static var files: [String: Data] = [:]
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let data = Self.files[request.url!.absoluteString]
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1",
        headerFields: nil)!, cacheStoragePolicy: .notAllowed)
    if let data { client?.urlProtocol(self, didLoad: data) }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

@MainActor @Suite("Runtime code switch", .serialized)
struct RuntimeUpdateTests {
  @Test(.timeLimit(.minutes(2))) func realBackendAndWebViewCommitAndRollback() async throws {
    _ = NSApplication.shared
    let f = CodeReleaseTests.Fixture()
    defer {
      f.cleanup()
      RuntimeUpdateURLProtocol.files = [:]
    }
    let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    let bun = repository.appending(path: "packages/cli/assets/darwin-arm64/bun")
    let backendModule = repository.appending(path: "packages/cli/dist/backend.js").path
    guard FileManager.default.fileExists(atPath: bun.path),
      FileManager.default.fileExists(atPath: backendModule)
    else {
      throw UpdateError(
        "Run bun run runtime:build and bun run cli:build before runtime integration tests")
    }
    let quotedModule = String(data: try JSONEncoder().encode(backendModule), encoding: .utf8)!
    let backend = """
      import { defineBackend, runBackend } from \(quotedModule);
      await runBackend(defineBackend({http:{}, async start({native}) {
        await native.windows.create({id:"aux",title:"Update Test"});
        await native.windows.setTitlebar({id:"main",items:[{type:"text",id:"build",label:"Test"}]});
      }}));
      """
    let frontend = """
      <!doctype html><html><body><main>Mounted update</main><script>
      const query = new URLSearchParams(location.search);
      fetch('/_fia/ready', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({windowId:query.get('fiaWindow'),generation:query.get('fiaGeneration')})});
      </script></body></html>
      """
    let bundleURL = f.root.appending(path: "Update Test.app")
    let factory = bundleURL.appending(path: "Contents/Resources/code")
    let helpers = bundleURL.appending(path: "Contents/Helpers")
    try FileManager.default.createDirectory(at: helpers, withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: bun, to: helpers.appending(path: "bun"))
    let executables = bundleURL.appending(path: "Contents/MacOS")
    try FileManager.default.createDirectory(at: executables, withIntermediateDirectories: true)
    try FileManager.default.copyItem(
      at: bun.deletingLastPathComponent().appending(path: "FIAHost"),
      to: executables.appending(path: "FIAHost"))
    try Data(
      "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>com.example.updates</string><key>CFBundleExecutable</key><string>FIAHost</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>"
        .utf8
    ).write(to: bundleURL.appending(path: "Contents/Info.plist"))
    let first = try f.write(1, at: factory, backend: backend, frontend: frontend, extra: ["agent/update-test/SKILL.md": "skill-1"])
    let bundle = try #require(Bundle(url: bundleURL))
    let networkConfig = URLSessionConfiguration.ephemeral
    networkConfig.protocolClasses = [RuntimeUpdateURLProtocol.self]
    let network = URLSession(configuration: networkConfig)
    defer { network.invalidateAndCancel() }
    try await codesign(["--force", "--sign", "-", helpers.appending(path: "bun").path])
    try await codesign(["--force", "--sign", "-", executables.appending(path: "FIAHost").path])
    let manifest = RuntimeManifest(
      schema: 4, frameworkVersion: FIAVersion.current,
      app: .init(
        name: "Update Test", identifier: first.identifier, version: first.version, build: 1),
      bunSHA256: try fileSHA256(helpers.appending(path: "bun")), runtimeId: first.runtimeId,
      developmentEntry: nil,
      agent: AgentConfiguration(command: "update-test", description: "Update test"),
      statusItem: .init(symbol: "number.circle", tooltip: "FIA test"),
      updates: UpdateConfiguration(
        url: "https://example.com/latest.json", publicKey: f.publicKey, downloadURL: nil))
    try JSONEncoder().encode(manifest).write(
      to: bundleURL.appending(path: "Contents/Resources/fia.runtime.json"))
    try await codesign(["--force", "--sign", "-", bundleURL.path])
    try await codesign(["--verify", "--deep", "--strict", bundleURL.path])
    let runtime = try FIARuntime(
      manifest: manifest, bundle: bundle, supportDirectory: f.root.appending(path: "data"),
      updateNetwork: network)
    runtime.updater.confirmInstallation = { _ in true }
    do {
      try await runtime.start(automaticUpdates: false, background: true)
      #expect(runtime.windows.states.allSatisfy { !$0.orderedIn })
      let delegate = ApplicationDelegate(runtime: runtime, manifest: manifest, headless: true)
      delegate.installStatusItem()
      let tray = try #require(delegate.statusItem)
      defer { NSStatusBar.system.removeStatusItem(tray) }
      let menu = try #require(tray.menu)
      #expect(menu.items.map(\.title) == ["Show", "Install Command Line Tool…", "", "Quit"])
      #expect(menu.items.last?.action == #selector(NSApplication.terminate(_:)))
      menu.performActionForItem(at: 0)
      #expect(runtime.windows.states.contains { $0.id == "main" && $0.orderedIn })
      _ = try runtime.windows.operate("hide", id: "main")
      #expect(runtime.windows.states.allSatisfy { !$0.orderedIn })
      let installedSkill = f.root.appending(path: "data/\(first.identifier)/Agent/current/update-test/SKILL.md")
      #expect(try String(contentsOf: installedSkill, encoding: .utf8) == "skill-1")
      let windows = runtime.windows.registeredIDs
      #expect(windows == ["aux", "main"])
      func offer(_ build: Int, code: String, page: String) throws {
        let remote = f.root.appending(path: "remote/\(build)")
        let release = try f.write(build, at: remote, backend: code, frontend: page, extra: ["agent/update-test/SKILL.md": "skill-\(build)"])
        RuntimeUpdateURLProtocol.files = [
          "https://example.com/latest.json": try Data(
            contentsOf: remote.appending(path: "release.json"))
        ]
        for file in release.files {
          RuntimeUpdateURLProtocol.files[release.baseURL + file.path] = try Data(
            contentsOf: remote.appending(path: file.path))
        }
      }
      func applyAndWait() async throws {
        _ = try await runtime.updater.check()
        _ = try await runtime.updater.download()
        _ = try await runtime.updater.apply()
        let deadline = Date().addingTimeInterval(48)
        while runtime.updater.state.phase == "applying" {
          if Date() >= deadline { throw UpdateError("Runtime update did not finish") }
          try await Task.sleep(for: .milliseconds(100))
        }
      }
      try offer(2, code: backend, page: frontend)
      try await applyAndWait()
      #expect(try String(contentsOf: installedSkill, encoding: .utf8) == "skill-2")
      #expect(runtime.windows.states.allSatisfy { !$0.orderedIn })
      #expect(runtime.updater.state.phase == "current")
      #expect(runtime.windows.registeredIDs == windows)
      #expect(try await currentBuild(runtime) == 2)

      // A candidate can start successfully and then crash within its observation window.
      try offer(3, code: backend + "\nsetTimeout(() => process.exit(1), 1000);", page: frontend)
      try await applyAndWait()
      #expect(runtime.updater.state.phase == "failed")
      #expect(try await currentBuild(runtime) == 2)
      #expect(try String(contentsOf: installedSkill, encoding: .utf8) == "skill-2")

      // Closed windows must not allow a broken frontend to bypass hidden validation.
      for id in runtime.windows.openIDs { _ = try runtime.windows.operate("close", id: id) }
      // Serving HTML alone is insufficient: every WebView must report its first mount.
      try offer(4, code: backend, page: "<!doctype html><html><body>No ready report</body></html>")
      try await applyAndWait()
      #expect(runtime.updater.state.phase == "failed")
      #expect(try await currentBuild(runtime) == 2)
      #expect(runtime.windows.registeredIDs == windows)
      #expect(try String(contentsOf: installedSkill, encoding: .utf8) == "skill-2")
      #expect(runtime.windows.states.allSatisfy { !$0.orderedIn })
      #expect(try await runtime.updater.check().phase == "current")
      try await codesign(["--verify", "--deep", "--strict", bundleURL.path])
    } catch {
      _ = await runtime.stop()
      for id in runtime.windows.openIDs { _ = try? runtime.windows.operate("close", id: id) }
      throw error
    }
    #expect(await runtime.stop().completed)
    for id in runtime.windows.openIDs { _ = try? runtime.windows.operate("close", id: id) }
  }
  private func codesign(_ arguments: [String]) async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, any Error>) in
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
      process.arguments = arguments
      let output = Pipe()
      process.standardOutput = output
      process.standardError = output
      process.terminationHandler = { process in
        if process.terminationStatus == 0 {
          continuation.resume()
        } else {
          continuation.resume(
            throwing: UpdateError(
              "codesign failed: "
                + String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            ))
        }
      }
      do { try process.run() } catch { continuation.resume(throwing: error) }
    }
  }
  private func currentBuild(_ runtime: FIARuntime) async throws -> Int {
    switch await runtime.native.dispatch(method: "application.info", params: Data("{}".utf8)) {
    case .success(let data):
      return try #require(
        (JSONSerialization.jsonObject(with: data) as? [String: Any])?["build"] as? Int)
    case .failure(let error): throw error
    }
  }
}
