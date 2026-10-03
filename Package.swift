// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FIA", platforms: [.macOS(.v14)],
    products: [.executable(name: "FIAHost", targets: ["FIAHost"])],
    targets: [
        .target(name: "FIACore", linkerSettings: [.linkedFramework("Security")]),
        .target(name: "FIAProcessSupport", publicHeadersPath: "include"),
        .target(name: "FIAMacOS", dependencies: ["FIACore", "FIAProcessSupport"], linkerSettings: [
            .linkedFramework("AppKit"), .linkedFramework("Carbon"), .linkedFramework("CFNetwork"), .linkedFramework("Security")]),
        .target(name: "FIA", dependencies: ["FIACore", "FIAMacOS"], linkerSettings: [
            .linkedFramework("AppKit"), .linkedFramework("WebKit"), .linkedFramework("ScreenCaptureKit"),
            .linkedFramework("UserNotifications"), .linkedFramework("CoreText")]),
        .executableTarget(name: "FIAHost", dependencies: ["FIA"]),
        .testTarget(name: "FIACoreTests", dependencies: ["FIACore"]),
        .testTarget(name: "FIAMacOSTests", dependencies: ["FIAMacOS", "FIACore"]),
        .testTarget(name: "FIATests", dependencies: ["FIA"]),
    ], swiftLanguageModes: [.v6]
)
