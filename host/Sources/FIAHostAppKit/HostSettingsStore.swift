import FIAHostCore
import Foundation

@MainActor
final class HostSettingsStore {
    private let settingsURL: URL
    private let diagnostic: (String) -> Void
    private var pendingSave: Task<Void, Never>?

    init(
        identifier: String,
        applicationSupportDirectory: URL? = nil,
        diagnostic: @escaping (String) -> Void
    ) throws {
        let base = try applicationSupportDirectory ?? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = base.appendingPathComponent(identifier, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        settingsURL = directory.appendingPathComponent("settings-v2.json", isDirectory: false)
        self.diagnostic = diagnostic
    }

    deinit { pendingSave?.cancel() }

    func load(fallbackSymbol: String) -> HostSettings {
        guard FileManager.default.fileExists(atPath: settingsURL.path) else {
            return HostSettings(statusItemSymbol: fallbackSymbol)
        }
        do {
            return try HostSettings.decode(Data(contentsOf: settingsURL, options: [.mappedIfSafe]))
        } catch {
            diagnostic("ignoring invalid host settings: \(error)")
            return HostSettings(statusItemSymbol: fallbackSymbol)
        }
    }

    func scheduleSave(_ settings: HostSettings) {
        pendingSave?.cancel()
        pendingSave = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            self?.save(settings)
        }
    }

    func flush(_ settings: HostSettings) {
        pendingSave?.cancel()
        pendingSave = nil
        save(settings)
    }

    private func save(_ settings: HostSettings) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            var data = try encoder.encode(settings)
            data.append(0x0A)
            try data.write(to: settingsURL, options: .atomic)
        } catch {
            diagnostic("could not save host settings: \(error.localizedDescription)")
        }
    }
}
