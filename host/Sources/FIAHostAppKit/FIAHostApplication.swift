import AppKit

@MainActor
public enum FIAHostApplication {
    public static func run() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}
