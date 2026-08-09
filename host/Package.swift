// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FIAHost",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "FIAHost", targets: ["FIAHost"]),
        .library(name: "FIAHostCore", targets: ["FIAHostCore"]),
        .library(name: "FIAHostAppKit", targets: ["FIAHostAppKit"]),
    ],
    targets: [
        .target(
            name: "FIAHostCore",
            linkerSettings: [.linkedFramework("Security")]
        ),
        .target(
            name: "FIAHostAppKit",
            dependencies: ["FIAHostCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Security"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("UserNotifications"),
                .linkedFramework("WebKit"),
            ]
        ),
        .executableTarget(name: "FIAHost", dependencies: ["FIAHostAppKit"]),
        .testTarget(name: "FIAHostCoreTests", dependencies: ["FIAHostCore"]),
        .testTarget(name: "FIAHostAppKitTests", dependencies: ["FIAHostAppKit", "FIAHostCore"]),
    ]
)
