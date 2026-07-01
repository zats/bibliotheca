import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct BibliothecaStoreInstallerTests {
    @Test
    func firstInstallDisablesUserExtensionsAndEnablesManager() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let installer = BibliothecaStoreInstaller(fileSystem: fileSystem)
        let templateURL = rootURL.appending(path: "template", directoryHint: .isDirectory)
        let destinationURL = rootURL.appending(path: "extensions", directoryHint: .isDirectory)
        try Self.writeTemplate(at: templateURL)

        try installer.installDisabledTemplate(from: templateURL, to: destinationURL, codexAppVersion: "26.1")

        let state = try Self.state(at: destinationURL)
        #expect(state["accounts"] == false)
        #expect(state["colors"] == false)
        #expect(state["extensions-manager"] == true)
    }

    @Test
    func reinstallPreservesUserExtensionEnabledState() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let installer = BibliothecaStoreInstaller(fileSystem: fileSystem)
        let templateURL = rootURL.appending(path: "template", directoryHint: .isDirectory)
        let destinationURL = rootURL.appending(path: "extensions", directoryHint: .isDirectory)
        try Self.writeTemplate(at: templateURL)
        try fileSystem.writeData(
            try JSONSerialization.data(withJSONObject: [
                "accounts": true,
                "colors": false,
                "extensions-manager": false,
            ], options: [.prettyPrinted, .sortedKeys]),
            to: destinationURL.appending(path: "state.json")
        )

        try installer.installDisabledTemplate(from: templateURL, to: destinationURL, codexAppVersion: "26.2")

        let state = try Self.state(at: destinationURL)
        #expect(state["accounts"] == true)
        #expect(state["colors"] == false)
        #expect(state["extensions-manager"] == true)
    }

    private static func makeRoot() throws -> URL {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "bibliotheca-store-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        return rootURL
    }

    private static func writeTemplate(at rootURL: URL) throws {
        try Self.writeManifest(
            id: "accounts",
            internalExtension: false,
            at: rootURL.appending(path: "accounts/manifest.json")
        )
        try Self.writeManifest(
            id: "colors",
            internalExtension: false,
            at: rootURL.appending(path: "colors/manifest.json")
        )
        try Self.writeManifest(
            id: "extensions-manager",
            internalExtension: false,
            at: rootURL.appending(path: "extensions-manager/manifest.json")
        )
        try Self.writeManifest(
            id: "bootloader",
            internalExtension: true,
            at: rootURL.appending(path: "bootloader/manifest.json")
        )
    }

    private static func writeManifest(id: String, internalExtension: Bool, at url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let manifest: [String: Any] = [
            "id": id,
            "codexAppVersion": "old",
            "internal": internalExtension,
        ]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: url)
    }

    private static func state(at rootURL: URL) throws -> [String: Bool] {
        let data = try Data(contentsOf: rootURL.appending(path: "state.json"))
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Bool])
    }
}
