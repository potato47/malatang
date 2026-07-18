// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FIAHost",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "FIAHost", targets: ["FIAHost"]),
        .library(name: "FIAHostCore", targets: ["FIAHostCore"]),
    ],
    targets: [
        .target(
            name: "FIAHostCore",
            linkerSettings: [.linkedFramework("Security")]
        ),
        .executableTarget(
            name: "FIAHost",
            dependencies: ["FIAHostCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
            ]
        ),
        .testTarget(name: "FIAHostCoreTests", dependencies: ["FIAHostCore"]),
    ]
)

