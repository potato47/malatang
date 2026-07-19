import FIAHostCore
import Foundation

@MainActor
final class DesktopSettingsStore {
    private let settingsURL: URL
    private let diagnostic: (String) -> Void
    private var pendingSave: Task<Void, Never>?

    init(identifier: String, diagnostic: @escaping (String) -> Void) throws {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent(identifier, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        settingsURL = directory.appendingPathComponent("settings.json", isDirectory: false)
        self.diagnostic = diagnostic
    }

    deinit {
        pendingSave?.cancel()
    }

    func load() -> DesktopSettings? {
        guard FileManager.default.fileExists(atPath: settingsURL.path) else { return nil }
        do {
            return try DesktopSettings.decode(Data(contentsOf: settingsURL, options: [.mappedIfSafe]))
        } catch {
            diagnostic("ignoring invalid desktop settings: \(error)")
            return nil
        }
    }

    func scheduleSave(state: DesktopState, windowFrame: DesktopWindowFrame?) {
        pendingSave?.cancel()
        let settings = DesktopSettings(state: state, windowFrame: windowFrame)
        pendingSave = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            self?.save(settings)
        }
    }

    func flush(state: DesktopState, windowFrame: DesktopWindowFrame?) {
        pendingSave?.cancel()
        pendingSave = nil
        save(DesktopSettings(state: state, windowFrame: windowFrame))
    }

    private func save(_ settings: DesktopSettings) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            var data = try encoder.encode(settings)
            data.append(0x0A)
            try data.write(to: settingsURL, options: .atomic)
        } catch {
            diagnostic("could not save desktop settings: \(error.localizedDescription)")
        }
    }
}
