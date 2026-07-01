import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct CodexPatchBackupStoreTests {
    @Test
    func returnsOnlyReceiptLinkedCurrentVersionBackup() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let store = CodexPatchBackupStore(
            rootURL: rootURL,
            fileSystem: fileSystem,
            patchInspector: CodexPatchInspector(fileSystem: fileSystem)
        )
        let backupURL = rootURL.appending(path: "26.1-clean", directoryHint: .isDirectory)
        try Self.writeBackup(at: backupURL)
        let receipt = CodexProvisioningReceipt(
            appPath: "/Applications/Codex.app",
            appVersion: "26.1",
            appASARSHA256: "patched",
            cleanAppASARSHA256: "clean",
            patchedAppASARSHA256: "patched",
            backupDirectoryPath: backupURL.path,
            provisionedAt: Date()
        )

        let matching = store.backupURL(
            from: receipt,
            appURL: URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "patched",
                updateFeedURL: nil
            )
        )
        let differentVersion = store.backupURL(
            from: receipt,
            appURL: URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.2"),
                appASARSHA256: "other",
                updateFeedURL: nil
            )
        )

        #expect(matching?.path == backupURL.path)
        #expect(differentVersion == nil)
    }

    @Test
    func rejectsPatchedReceiptBackup() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let store = CodexPatchBackupStore(
            rootURL: rootURL,
            fileSystem: fileSystem,
            patchInspector: CodexPatchInspector(fileSystem: fileSystem)
        )
        let backupURL = rootURL.appending(path: "26.1-patched", directoryHint: .isDirectory)
        try Self.writeBackup(at: backupURL, patched: true)
        let receipt = CodexProvisioningReceipt(
            appPath: "/Applications/Codex.app",
            appVersion: "26.1",
            appASARSHA256: "patched",
            cleanAppASARSHA256: "clean",
            patchedAppASARSHA256: "patched",
            backupDirectoryPath: backupURL.path,
            provisionedAt: Date()
        )

        let matching = store.backupURL(
            from: receipt,
            appURL: URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "patched",
                updateFeedURL: nil
            )
        )

        #expect(matching == nil)
    }

    @Test
    func pruneRetainingKeepsExactlyOneBackup() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let store = CodexPatchBackupStore(
            rootURL: rootURL,
            fileSystem: fileSystem,
            patchInspector: CodexPatchInspector(fileSystem: fileSystem)
        )
        let retainedURL = rootURL.appending(path: "current", directoryHint: .isDirectory)
        let staleURL = rootURL.appending(path: "stale", directoryHint: .isDirectory)
        try Self.writeBackup(at: retainedURL)
        try Self.writeBackup(at: staleURL)

        try store.pruneRetaining(retainedURL)

        #expect(fileSystem.directoryExists(at: retainedURL))
        #expect(!fileSystem.directoryExists(at: staleURL))
    }

    @Test
    func pruneAllRemovesBackupsAfterCleanRestore() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let store = CodexPatchBackupStore(
            rootURL: rootURL,
            fileSystem: fileSystem,
            patchInspector: CodexPatchInspector(fileSystem: fileSystem)
        )
        try Self.writeBackup(at: rootURL.appending(path: "current", directoryHint: .isDirectory))

        try store.pruneAll()

        #expect((try fileSystem.contentsOfDirectory(at: rootURL)).isEmpty)
    }

    private static func makeRoot() throws -> URL {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-backup-store-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        return rootURL
    }

    private static func writeBackup(at backupURL: URL, patched: Bool = false) throws {
        try FileManager.default.createDirectory(at: backupURL, withIntermediateDirectories: true)
        let asar = patched
            ? "codex_desktop:extensions-bootloader-preload-source main bootloader failed .codex bootloader"
            : "clean-asar"
        try Data(asar.utf8).write(to: backupURL.appending(path: "app.asar"))
        try Data("plist".utf8).write(to: backupURL.appending(path: "Info.plist"))
    }
}
