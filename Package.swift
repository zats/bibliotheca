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
        .package(path: "Vendor/Permiso"),
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
