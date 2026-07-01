import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct CodexPatcherIntegrationTests {
    @Test
    func patchAndRollbackTemporaryCodexCopy() throws {
        guard ProcessInfo.processInfo.environment["CODEX_SETUP_RUN_INTEGRATION"] == "1" else {
            return
        }

        let sourceAppURL = URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory)
        let fileManager = FileManager()
        guard fileManager.fileExists(atPath: sourceAppURL.path) else {
            return
        }

        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-setup-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        let appURL = rootURL.appending(path: "Codex.app", directoryHint: .isDirectory)
        defer { try? fileManager.removeItem(at: rootURL) }

        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try fileManager.copyItem(at: sourceAppURL, to: appURL)

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let patcher = CodexAppPatcher(fileSystem: fileSystem)
        let inspector = CodexPatchInspector(fileSystem: fileSystem)
        if try inspector.isPatched(appURL: appURL) {
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
        #expect(try !inspector.isPatched(appURL: appURL))

        let result = try patcher.patch(
            appURL: appURL,
            appVersion: "test",
            backupRootURL: rootURL.appending(path: "backups", directoryHint: .isDirectory)
        )

        #expect(try inspector.isPatched(appURL: appURL))
        let activation = try Self.mainActivationSnippet(in: appURL)
        #expect(activation.contains(".codex`,`extensions`,`bootloader`,`src`,`main.js`"))
        #expect(activation.contains("activate({electron:__e,appVersion:__e.app.getVersion()})"))
        #expect(!activation.contains("windowServices"))
        #expect(!activation.contains("getAppServerConnection"))
        #expect(!activation.contains("query-cache-invalidate"))

        try patcher.rollback(appURL: appURL, backupDirectoryURL: result.backupDirectoryURL)
        #expect(try !inspector.isPatched(appURL: appURL))
    }

    private static func mainActivationSnippet(in appURL: URL) throws -> String {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-setup-extract-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let asar = try CodexToolLocator(fileSystem: LocalBibliothecaSetupFileSystem()).asarCommand()
        _ = try CodexProcessRunner().run(
            asar.executable.path,
            arguments: asar.arguments + [
                "extract",
                appURL.appending(path: "Contents/Resources/app.asar").path,
                rootURL.path,
            ],
            environment: asar.environment
        )

        let buildURL = rootURL.appending(path: ".vite/build", directoryHint: .isDirectory)
        for fileURL in try FileManager.default.contentsOfDirectory(at: buildURL, includingPropertiesForKeys: nil) where fileURL.pathExtension == "js" {
            let source = try String(contentsOf: fileURL, encoding: .utf8)
            if let range = source.range(of: ".codex`,`extensions`,`bootloader`,`src`,`main.js`") {
                let lower = range.lowerBound
                let upper = source[range.upperBound...].range(of: "})();")?.upperBound ?? source.index(range.upperBound, offsetBy: 400, limitedBy: source.endIndex) ?? source.endIndex
                return String(source[lower..<upper])
            }
        }
        throw BibliothecaSetupError.patchPatternMissing("patched main bundle")
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
