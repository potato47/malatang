// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FIABackend",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "FIABackend", targets: ["FIABackend"]),
    ],
    targets: [
        .target(name: "FIABackend"),
        .testTarget(name: "FIABackendTests", dependencies: ["FIABackend"]),
    ]
)
