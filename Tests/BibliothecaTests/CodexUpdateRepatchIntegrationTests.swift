import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct CodexUpdateRepatchIntegrationTests {
    @Test
    func repatchesCleanCodexCopyAfterProvisionedUpdate() async throws {
        guard ProcessInfo.processInfo.environment["CODEX_SETUP_RUN_INTEGRATION"] == "1" else {
            return
        }

        let sourceAppURL = URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory)
        let fileManager = FileManager()
        guard fileManager.fileExists(atPath: sourceAppURL.path) else {
            return
        }
        guard !CodexAppProcessController().isRunning(appURL: sourceAppURL, bundleIdentifier: "com.openai.codex") else {
            return
        }

        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-update-repatch-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        let appURL = rootURL.appending(path: "Codex.app", directoryHint: .isDirectory)
        defer { try? fileManager.removeItem(at: rootURL) }

        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try fileManager.copyItem(at: sourceAppURL, to: appURL)

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let patchInspector = CodexPatchInspector(fileSystem: fileSystem)
        if try patchInspector.isPatched(appURL: appURL) {
            let cleanBackupURL = try Self.cleanBackupDirectory()
            try fileSystem.copyItem(
                at: cleanBackupURL.appending(path: "app.asar"),
                to: appURL.appending(path: "Contents/Resources/app.asar")
            )
            try fileSystem.copyItem(
                at: cleanBackupURL.appending(path: "Info.plist"),
                to: appURL.appending(path: "Contents/Info.plist")
            )
        }
        #expect(try !patchInspector.isPatched(appURL: appURL))

        let liveConfiguration = BibliothecaSetupConfiguration.liveDefault()
        let configuration = BibliothecaSetupConfiguration(
            candidateAppURLs: [appURL],
            extensionsRootURL: rootURL.appending(path: "extensions", directoryHint: .isDirectory),
            provisioningReceiptURL: rootURL.appending(path: "extensions/receipt.json"),
            bundledExtensionsRootURL: liveConfiguration.bundledExtensionsRootURL,
            codexUpdateFeedURL: nil
        )
        let service = BibliothecaSetupService(configuration: configuration, fileSystem: fileSystem)
        let identity = try CodexAppBundleInspector(fileSystem: fileSystem).identity(at: appURL)
        let receipt = CodexProvisioningReceipt(
            appPath: appURL.path,
            appVersion: "previous-\(identity.version.shortVersion)",
            appASARSHA256: "previous-hash",
            cleanAppASARSHA256: "previous-clean-hash",
            patchedAppASARSHA256: "previous-patched-hash",
            backupDirectoryPath: nil,
            provisionedAt: Date()
        )
        try fileSystem.writeData(try JSONEncoder().encode(receipt), to: configuration.provisioningReceiptURL)

        let before = await service.inspect(selectedAppURL: appURL)
        #expect(CodexUpdateRepatchPolicy.plan(for: before) == .patchAndLaunch)

        let outcome = try await service.repatchUpdatedCodexIfNeeded(selectedAppURL: appURL, launchAfterPatch: false)
        let after = await service.inspect(selectedAppURL: appURL)
        let secondOutcome = try await service.repatchUpdatedCodexIfNeeded(selectedAppURL: appURL, launchAfterPatch: false)

        #expect(outcome == .repatched)
        #expect(after.patchState == .patched)
        #expect(secondOutcome == .skipped)
    }

    private static func cleanBackupDirectory() throws -> URL {
        let backupRoot = URL(filePath: NSHomeDirectory(), directoryHint: .isDirectory)
            .appending(path: ".codex/extensions/.bibliotheca-backups", directoryHint: .isDirectory)
        let fileSystem = LocalBibliothecaSetupFileSystem()
        let inspector = CodexPatchInspector(fileSystem: fileSystem)
        for backupURL in try fileSystem.contentsOfDirectory(at: backupRoot).sorted(by: { $0.path < $1.path }) {
            let asarURL = backupURL.appending(path: "app.asar")
            let infoURL = backupURL.appending(path: "Info.plist")
            if fileSystem.fileExists(at: asarURL),
               fileSystem.fileExists(at: infoURL),
               try !inspector.isPatchedASAR(at: asarURL) {
                return backupURL
            }
        }
        throw BibliothecaSetupError.rollbackBackupMissing
    }
}
