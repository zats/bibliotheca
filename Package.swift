// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Bibliotheca",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v26),
    ],
    products: [
        .executable(name: "Bibliotheca", targets: ["Bibliotheca"]),
        .executable(name: "bibliotheca-setup", targets: ["BibliothecaSetupCLI"]),
        .library(name: "BibliothecaSetup", targets: ["BibliothecaSetup"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.3"),
        .package(url: "https://github.com/tesseract-one/xxHash.swift", from: "0.1.0"),
        .package(url: "https://github.com/zats/permiso", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "Bibliotheca",
            dependencies: [
                "BibliothecaSetup",
                .product(name: "Permiso", package: "Permiso"),
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "BibliothecaSetup",
            dependencies: [
                .product(name: "xxHash", package: "xxHash.swift"),
            ],
            resources: [
                .copy("Resources/BundledExtensions"),
                .copy("Resources/BundledSkills"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "BibliothecaSetupCLI",
            dependencies: ["BibliothecaSetup"],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "BibliothecaTests",
            dependencies: ["BibliothecaSetup"]
        ),
    ])
