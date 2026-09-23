import Darwin
import Foundation

struct AgentConfiguration: Codable, Sendable {
  let command: String
  let description: String
}
struct AgentCLIStatus: Codable, Sendable {
  let path: String
  let installed: Bool
  let conflict: Bool?
  let onPath: Bool?
  let pathHint: String?
}
enum AgentCLI {
  static func recordStartupFailure(_ error: Error) {
    guard let manifest = try? RuntimeManifest.load(),
      let support = try? supportDirectory(identifier: manifest.app.identifier) else { return }
    let directory = support.appending(path: "Agent")
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      let failure: [String: Any] = ["identifier": manifest.app.identifier, "runtimeId": manifest.runtimeId,
        "bundlePath": Bundle.main.bundleURL.path, "createdAt": Date().timeIntervalSince1970 * 1000,
        "code": "startup_failed", "message": error.localizedDescription]
      let target = directory.appending(path: "failure.json")
      try JSONSerialization.data(withJSONObject: failure).write(to: target, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    } catch { fputs("FIA could not record startup failure: \(error.localizedDescription)\n", stderr) }
  }
  static func clearStartupFailure(identifier: String) {
    guard let support = try? supportDirectory(identifier: identifier) else { return }
    try? FileManager.default.removeItem(at: support.appending(path: "Agent/failure.json"))
  }
  static func supportDirectory(identifier: String) throws -> URL {
    let root = try ProcessInfo.processInfo.environment["FIA_DATA_DIRECTORY"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return root.appending(path: identifier)
  }
  static func arguments(bundle: Bundle, support: URL, command: [String]) -> [String] {
    ["--no-env-file", "--no-orphans", bundle.bundleURL.appending(path: "Contents/Resources/agent-cli.js").path,
      bundle.bundleURL.resolvingSymlinksInPath().path, support.path] + command
  }
  static func run() throws -> Never {
    let manifest = try RuntimeManifest.load()
    let bundle = Bundle.main
    let executable = bundle.bundleURL.appending(path: "Contents/Helpers/bun").path
    guard try fileSHA256(URL(fileURLWithPath: executable)) == manifest.bunSHA256 else { throw UpdateError("Bundled Bun integrity failed") }
    let argv = [executable] + arguments(bundle: bundle, support: try supportDirectory(identifier: manifest.app.identifier), command: Array(CommandLine.arguments.dropFirst(2)))
    var pointers = argv.map { strdup($0) } + [nil]
    defer { for pointer in pointers { free(pointer) } }
    execv(executable, &pointers)
    throw UpdateError("Could not launch CLI: " + String(cString: strerror(errno)))
  }
  static func manage(bundleURL: URL, support: URL, command: String) async throws -> AgentCLIStatus {
    try await Task.detached {
      guard let bundle = Bundle(url: bundleURL) else { throw UpdateError("Application bundle is missing") }
      let process = Process()
      process.executableURL = bundleURL.appending(path: "Contents/Helpers/bun")
      process.arguments = arguments(bundle: bundle, support: support, command: [command])
      let output = Pipe(), errors = Pipe()
      process.standardOutput = output; process.standardError = errors
      try process.run()
      let data = output.fileHandleForReading.readDataToEndOfFile()
      let error = errors.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      guard process.terminationStatus == 0 else { throw UpdateError(String(decoding: error, as: UTF8.self)) }
      return try JSONDecoder().decode(AgentCLIStatus.self, from: data)
    }.value
  }
}
