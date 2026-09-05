// swift-tools-version: 6.0

import Foundation
import PackageDescription

var fiaDependencies: [Target.Dependency] = ["FIACore", "FIAMacOS", "FIAWeb", "FIAUpdater"]
if ProcessInfo.processInfo.environment["FIA_BUILD_SPARKLE"] == "1" {
    fiaDependencies.append("FIASparkleProvider")
}

let package = Package(
    name: "FIA",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "FIA", targets: ["FIA"]),
        .executable(name: "FIAWorkbenchExample", targets: ["FIAWorkbenchExample"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", exact: "2.97.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.6"),
    ],
    targets: [
        .target(
            name: "FIACore",
            path: "Sources/FIACore",
            sources: ["BackendProtocol.swift", "FIAError.swift", "FIAVersion.swift"],
            linkerSettings: [.linkedFramework("Security")]
        ),
        .target(name: "FIAProcessSupport", path: "Sources/FIAProcessSupport", publicHeadersPath: "include"),
        .target(
            name: "FIAMacOS",
            dependencies: ["FIACore", "FIAProcessSupport"],
            path: "Sources/FIAMacOS",
            sources: ["BackendSupervisor.swift", "ManagedProcess.swift", "GlobalShortcutController.swift"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ImageIO"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Security"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("UserNotifications"),
                .linkedFramework("WebKit"),
            ]
        ),
        .target(
            name: "FIAWeb",
            dependencies: [
                "FIACore",
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "_NIOFileSystem", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "NIOWebSocket", package: "swift-nio"),
            ],
            path: "Sources/FIAWeb",
            linkerSettings: [.linkedFramework("Security")]
        ),
        .target(
            name: "FIAUpdaterObjC",
            path: "Sources/FIAUpdaterObjC",
            publicHeadersPath: "include",
            linkerSettings: [.linkedFramework("Foundation")]
        ),
        .target(
            name: "FIAUpdater",
            dependencies: ["FIACore", "FIAUpdaterObjC"],
            path: "Sources/FIAUpdater"
        ),
        .target(
            name: "FIASparkleProvider",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/FIASparkleProvider"
        ),
        .target(
            name: "FIA",
            dependencies: fiaDependencies,
            path: "Sources/FIA"
        ),
        .executableTarget(name: "FIAWorkbenchExample", dependencies: ["FIA"], path: "examples/native-workbench", exclude: ["README.md"]),
        .testTarget(
            name: "FIACoreTests",
            dependencies: ["FIACore"],
            path: "Tests/FIACoreTests",
            sources: ["BackendProtocolTests.swift"]
        ),
        .testTarget(
            name: "FIAMacOSTests",
            dependencies: ["FIAMacOS", "FIACore"],
            path: "Tests/FIAMacOSTests",
            sources: ["BackendSupervisorTests.swift", "ManagedProcessTests.swift", "GlobalShortcutControllerTests.swift"]
        ),
        .testTarget(
            name: "FIATests",
            dependencies: [
                "FIA", "FIAWeb", "FIAUpdater",
                .product(name: "NIOCore", package: "swift-nio"),
                .product(name: "NIOHTTP1", package: "swift-nio"),
                .product(name: "NIOPosix", package: "swift-nio"),
                .product(name: "NIOWebSocket", package: "swift-nio"),
            ],
            path: "Tests/FIATests"
        ),
    ],
    swiftLanguageModes: [.v6]
)
