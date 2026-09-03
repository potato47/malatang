import AppKit
import FIAHostAppKit
import FIAHostCore
import Foundation
import XCTest

@MainActor
private final class RecordingHostWindowFactory: FIAHostWindowFactory {
    private(set) var configurations: [FIAHostWindowConfiguration] = []
    private(set) var windows: [NSWindow] = []

    func makeWindow(configuration: FIAHostWindowConfiguration) -> NSWindow {
        configurations.append(configuration)
        let window = FIAHostWindow(
            contentRect: configuration.contentRect,
            styleMask: configuration.styleMask,
            acceptsKeyAndMain: configuration.acceptsKeyAndMain,
            dragRegion: configuration.dragRegion
        )
        windows.append(window)
        return window
    }
}

@MainActor
private struct EchoCapabilityProvider: FIAHostCapabilityProvider {
    func handle(method: String, params: [String: Any]) async throws -> FIAHostCapabilityResult {
        guard method == "aix.echo" else { return .unhandled }
        return .handled(["value": params["value"] ?? NSNull()])
    }
}

@MainActor
final class FIAHostRuntimeTests: XCTestCase {
    func testComposesCustomWindowCapabilityAndControlledShutdown() async throws {
        _ = NSApplication.shared
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("fia-runtime-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let responsesURL = temporaryDirectory.appendingPathComponent("responses.jsonl")
        let script = #"""
        IFS= read -r initialize
        printf '%s\n' '{"v":2,"type":"ready","port":45682,"origin":"http://127.0.0.1:45682"}'
        printf '%s\n' '{"v":2,"type":"request","id":1,"method":"webviews.open","params":{"id":"main","url":"https://example.com","focus":false,"windowStyle":"overlay","dragRegion":{"height":52,"leftInset":88}}}'
        while IFS= read -r frame; do
          case "$frame" in
            *'"type":"response"'*)
              case "$frame" in *'"id":1'*) window_response="$frame"; break ;; esac
              ;;
          esac
        done
        printf '%s\n' '{"v":2,"type":"request","id":2,"method":"aix.echo","params":{"value":"hello"}}'
        while IFS= read -r frame; do
          case "$frame" in
            *'"type":"response"'*)
              case "$frame" in *'"id":2'*) capability_response="$frame"; break ;; esac
              ;;
          esac
        done
        printf '%s\n%s\n' "$window_response" "$capability_response" > "$0"
        while IFS= read -r event; do
          case "$event" in
            *host.shutdown*) exit 0 ;;
          esac
        done
        """#
        let configuration = HostConfiguration(
            development: true,
            app: .init(name: "Custom Host", identifier: "com.example.fia-runtime"),
            statusItem: .init(symbol: "bolt.fill", tooltip: "Custom Host"),
            backend: .init(
                executable: "/bin/sh",
                arguments: ["-c", script, responsesURL.path],
                sha256: String(repeating: "0", count: 64)
            )
        )
        let windowFactory = RecordingHostWindowFactory()
        let runtime = try FIAHostRuntime(
            configuration: configuration,
            applicationSupportDirectory: temporaryDirectory,
            windowFactory: windowFactory,
            capabilityProvider: EchoCapabilityProvider()
        )
        var states: [FIAHostRuntimeState] = []
        var terminationReady = false
        runtime.onStateChange = { states.append($0) }
        runtime.onTerminationReady = { terminationReady = true }

        runtime.start()
        let responseDeadline = ContinuousClock.now + .seconds(3)
        while (!FileManager.default.fileExists(atPath: responsesURL.path)
                || windowFactory.configurations.isEmpty),
              ContinuousClock.now < responseDeadline {
            try await Task.sleep(for: .milliseconds(20))
        }

        XCTAssertTrue(states.contains(.ready(port: 45_682)))
        let windowConfiguration = try XCTUnwrap(windowFactory.configurations.first)
        XCTAssertEqual(windowConfiguration.id, "main")
        XCTAssertEqual(windowConfiguration.style, .overlay)
        XCTAssertEqual(windowConfiguration.dragRegion, FIAHostWindowDragRegion(height: 52, leftInset: 88))
        let responseText = try String(contentsOf: responsesURL, encoding: .utf8)
        let responses = try responseText.split(separator: "\n").map { line in
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        }
        XCTAssertEqual(responses.count, 2)
        XCTAssertEqual(responses[0]["id"] as? Int, 1)
        XCTAssertEqual((responses[0]["result"] as? [String: Any])?["id"] as? String, "main")
        XCTAssertEqual(responses[1]["id"] as? Int, 2)
        XCTAssertEqual((responses[1]["result"] as? [String: Any])?["value"] as? String, "hello")

        XCTAssertEqual(runtime.prepareForTermination(), .waitForBackend)
        let stopDeadline = ContinuousClock.now + .seconds(3)
        while runtime.state != .stopped, ContinuousClock.now < stopDeadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(runtime.state, .stopped)
        XCTAssertTrue(terminationReady)
        runtime.applicationWillTerminate()
        windowFactory.windows.forEach { $0.close() }
    }
}
