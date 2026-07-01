// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CodexExtension",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .executable(name: "CodexExtension", targets: ["CodexExtension"]),
        .executable(name: "codex-extension-setup", targets: ["CodexSetupCLI"]),
        .library(name: "CodexSetup", targets: ["CodexSetup"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.3"),
        .package(url: "https://github.com/tesseract-one/xxHash.swift", from: "0.1.0"),
        .package(url: "https://github.com/zats/permiso", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "CodexExtension",
            dependencies: [
                "CodexSetup",
                .product(name: "Permiso", package: "Permiso"),
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CodexSetup",
            dependencies: [
                .product(name: "xxHash", package: "xxHash.swift"),
            ],
            resources: [
                .copy("Resources/BundledExtensions"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "CodexSetupCLI",
            dependencies: ["CodexSetup"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CodexExtensionTests",
            dependencies: ["CodexSetup"]
        ),
    ])
