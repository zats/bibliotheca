import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct CodexFileSystemTests {
    @Test
    func listsHiddenRestoreArtifacts() throws {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-filesystem-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let hiddenURL = rootURL.appending(path: ".bibliotheca-restore-backup-test.app", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: hiddenURL, withIntermediateDirectories: true)

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let names = try fileSystem.contentsOfDirectory(at: rootURL).map(\.lastPathComponent)

        #expect(names.contains(hiddenURL.lastPathComponent))
    }

    @Test
    func replacesDirectoryItemInPlace() throws {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-replace-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let originalURL = rootURL.appending(path: "Codex.app", directoryHint: .isDirectory)
        let stagedURL = rootURL.appending(path: ".bibliotheca-restore/Codex.app", directoryHint: .isDirectory)
        let backupName = ".bibliotheca-restore-backup-test.app"
        try FileManager.default.createDirectory(at: originalURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: stagedURL, withIntermediateDirectories: true)
        try Data("old".utf8).write(to: originalURL.appending(path: "marker"))
        try Data("new".utf8).write(to: stagedURL.appending(path: "marker"))

        let fileSystem = LocalBibliothecaSetupFileSystem()
        try fileSystem.replaceItem(at: originalURL, withItemAt: stagedURL, backupItemName: backupName)

        let marker = try String(contentsOf: originalURL.appending(path: "marker"), encoding: .utf8)
        #expect(marker == "new")
        #expect(!FileManager.default.fileExists(atPath: stagedURL.path))
    }
}
