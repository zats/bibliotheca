import Foundation

struct CodexPatchBackupStore: Sendable {
    private let fileSystem: BibliothecaSetupFileSystem
    private let patchInspector: CodexPatchInspector
    let rootURL: URL

    init(rootURL: URL, fileSystem: BibliothecaSetupFileSystem, patchInspector: CodexPatchInspector) {
        self.rootURL = rootURL
        self.fileSystem = fileSystem
        self.patchInspector = patchInspector
    }

    func backupURL(from receipt: CodexProvisioningReceipt, appURL: URL, appIdentity: CodexAppIdentity) -> URL? {
        guard receipt.appPath == appURL.path,
              receipt.appVersion == appIdentity.version.shortVersion,
              let backupDirectoryPath = receipt.backupDirectoryPath
        else {
            return nil
        }

        let backupURL = URL(filePath: backupDirectoryPath, directoryHint: .isDirectory)
        return self.isCleanBackup(backupURL) ? backupURL : nil
    }

    func isCleanBackup(_ backupURL: URL) -> Bool {
        let asarURL = backupURL.appending(path: "app.asar")
        let infoURL = backupURL.appending(path: "Info.plist")
        guard self.fileSystem.fileExists(at: asarURL),
              self.fileSystem.fileExists(at: infoURL),
              let patched = try? self.patchInspector.isPatchedASAR(at: asarURL)
        else {
            return false
        }
        return !patched
    }

    func pruneRetaining(_ retainedURL: URL) throws {
        try self.prune { candidateURL in
            candidateURL.standardizedFileURL.path == retainedURL.standardizedFileURL.path
        }
    }

    func pruneAll() throws {
        try self.prune { _ in false }
    }

    private func prune(shouldRetain: (URL) -> Bool) throws {
        guard self.fileSystem.directoryExists(at: self.rootURL) else {
            return
        }

        for itemURL in try self.fileSystem.contentsOfDirectory(at: self.rootURL) {
            guard self.fileSystem.directoryExists(at: itemURL), !shouldRetain(itemURL) else {
                continue
            }
            try self.fileSystem.removeItem(at: itemURL)
        }
    }
}
