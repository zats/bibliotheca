import Foundation
import Testing
@testable import CodexSetup

@Suite
struct CodexProvisioningStateTests {
    @Test
    func cleanRestoreCleanupKeepsExtensionDataAndRemovesReceiptAndBackups() throws {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-provisioning-state-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalCodexSetupFileSystem()
        let extensionsURL = rootURL.appending(path: "extensions", directoryHint: .isDirectory)
        let receiptURL = extensionsURL.appending(path: ".codex-extension-receipt.json")
        let backupURL = extensionsURL.appending(path: ".codex-extension-backups/current", directoryHint: .isDirectory)
        let dataURL = extensionsURL.appending(path: "colors/thread-colors.json")
        try fileSystem.writeData(Data("receipt".utf8), to: receiptURL)
        try fileSystem.writeData(Data("state".utf8), to: extensionsURL.appending(path: "state.json"))
        try fileSystem.writeData(Data("data".utf8), to: dataURL)
        try fileSystem.createDirectory(at: backupURL)

        let service = CodexSetupService(
            configuration: CodexSetupConfiguration(
                candidateAppURLs: [],
                extensionsRootURL: extensionsURL,
                provisioningReceiptURL: receiptURL,
                bundledExtensionsRootURL: rootURL.appending(path: "template", directoryHint: .isDirectory),
                codexUpdateFeedURL: nil
            ),
            fileSystem: fileSystem
        )

        try service.removeProvisioningState()

        #expect(fileSystem.directoryExists(at: extensionsURL))
        #expect(fileSystem.fileExists(at: dataURL))
        #expect(!fileSystem.fileExists(at: receiptURL))
        #expect(!fileSystem.directoryExists(at: backupURL))
    }

    @Test
    func failedCleanRestoreKeepsProvisioningReceiptAndExtensionData() async throws {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-restore-failure-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalCodexSetupFileSystem()
        let appURL = rootURL.appending(path: "FakeCodexForRestore.app", directoryHint: .isDirectory)
        try fileSystem.createDirectory(at: appURL.appending(path: "Contents/Resources", directoryHint: .isDirectory))

        let extensionsURL = rootURL.appending(path: "extensions", directoryHint: .isDirectory)
        let receiptURL = extensionsURL.appending(path: ".codex-extension-receipt.json")
        let dataURL = extensionsURL.appending(path: "colors/thread-colors.json")
        try fileSystem.writeData(Data("data".utf8), to: dataURL)

        let receipt = CodexProvisioningReceipt(
            appPath: appURL.path,
            appVersion: "26.1",
            appASARSHA256: "patched",
            cleanAppASARSHA256: "clean",
            patchedAppASARSHA256: "patched",
            backupDirectoryPath: nil,
            provisionedAt: Date()
        )
        let receiptData = try JSONEncoder().encode(receipt)
        try fileSystem.writeData(receiptData, to: receiptURL)

        let service = CodexSetupService(
            configuration: CodexSetupConfiguration(
                candidateAppURLs: [],
                extensionsRootURL: extensionsURL,
                provisioningReceiptURL: receiptURL,
                bundledExtensionsRootURL: rootURL.appending(path: "template", directoryHint: .isDirectory),
                codexUpdateFeedURL: nil
            ),
            fileSystem: fileSystem
        )

        do {
            try await service.restoreCleanCodex(
                from: CodexUpdateInfo(version: "26.2", downloadURL: nil),
                appURL: appURL,
                appIdentity: CodexAppIdentity(
                    bundleIdentifier: nil,
                    version: CodexAppVersion(shortVersion: "26.1"),
                    appASARSHA256: "patched",
                    updateFeedURL: nil
                )
            )
            Issue.record("Restore succeeded unexpectedly.")
        } catch CodexSetupError.updateFeedMalformed {
        } catch {
            Issue.record("Unexpected error: \(error)")
        }

        #expect(try fileSystem.readData(at: receiptURL) == receiptData)
        #expect(fileSystem.fileExists(at: dataURL))
    }
}
