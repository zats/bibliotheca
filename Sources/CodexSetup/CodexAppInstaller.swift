import Foundation

struct CodexAppInstaller: Sendable {
    private let fileSystem: CodexSetupFileSystem
    private let processRunner: CodexProcessRunner
    private let urlSession: URLSession

    init(
        fileSystem: CodexSetupFileSystem,
        processRunner: CodexProcessRunner = CodexProcessRunner(),
        urlSession: URLSession = .shared
    ) {
        self.fileSystem = fileSystem
        self.processRunner = processRunner
        self.urlSession = urlSession
    }

    func installCleanCodex(from update: CodexUpdateInfo, replacing appURL: URL) async throws {
        guard let downloadURL = update.downloadURL else {
            throw CodexSetupError.updateFeedMalformed
        }

        let temporaryRoot = try self.makeTemporaryDirectory()
        defer { try? self.fileSystem.removeItem(at: temporaryRoot) }

        let downloadedURL = temporaryRoot.appending(path: downloadURL.lastPathComponent.isEmpty ? "CodexUpdate" : downloadURL.lastPathComponent)
        let (temporaryDownloadURL, _) = try await self.urlSession.download(from: downloadURL)
        try self.fileSystem.moveItem(at: temporaryDownloadURL, to: downloadedURL)

        let cleanAppURL = try self.extractApp(from: downloadedURL, temporaryRoot: temporaryRoot)
        let oldAppURL = temporaryRoot.appending(path: "OldCodex.app", directoryHint: .isDirectory)
        if self.fileSystem.directoryExists(at: appURL) {
            try self.fileSystem.moveItem(at: appURL, to: oldAppURL)
        }

        do {
            try self.fileSystem.copyItem(at: cleanAppURL, to: appURL)
        } catch {
            if self.fileSystem.directoryExists(at: oldAppURL) {
                try? self.fileSystem.moveItem(at: oldAppURL, to: appURL)
            }
            throw error
        }
    }

    private func extractApp(from archiveURL: URL, temporaryRoot: URL) throws -> URL {
        let extractURL = temporaryRoot.appending(path: "extract", directoryHint: .isDirectory)
        try self.fileSystem.createDirectory(at: extractURL)

        if archiveURL.pathExtension.lowercased() == "dmg" {
            return try self.extractDMG(archiveURL, temporaryRoot: temporaryRoot)
        }

        _ = try self.processRunner.run("/usr/bin/ditto", arguments: ["-x", "-k", archiveURL.path, extractURL.path])
        return try self.findCodexApp(in: extractURL)
    }

    private func extractDMG(_ dmgURL: URL, temporaryRoot: URL) throws -> URL {
        let result = try self.processRunner.run(
            "/usr/bin/hdiutil",
            arguments: ["attach", "-nobrowse", "-readonly", "-plist", dmgURL.path]
        )
        let data = Data(result.output.utf8)
        guard let plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
              let entities = plist["system-entities"] as? [[String: Any]],
              let mountPoint = entities.compactMap({ $0["mount-point"] as? String }).first
        else {
            throw CodexSetupError.updateFeedMalformed
        }

        defer { _ = try? self.processRunner.run("/usr/bin/hdiutil", arguments: ["detach", mountPoint]) }

        let mountedAppURL = try self.findCodexApp(in: URL(filePath: mountPoint, directoryHint: .isDirectory))
        let copiedAppURL = temporaryRoot.appending(path: "MountedCodex.app", directoryHint: .isDirectory)
        try self.fileSystem.copyItem(at: mountedAppURL, to: copiedAppURL)
        return copiedAppURL
    }

    private func findCodexApp(in rootURL: URL) throws -> URL {
        var queue = [rootURL]
        while let directoryURL = queue.popLast() {
            for childURL in try self.fileSystem.contentsOfDirectory(at: directoryURL) {
                if childURL.pathExtension == "app" {
                    let infoURL = childURL.appending(path: "Contents/Info.plist")
                    guard let data = try? self.fileSystem.readData(at: infoURL),
                          let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
                          plist["CFBundleIdentifier"] as? String == "com.openai.codex"
                    else {
                        continue
                    }
                    return childURL
                }
                if self.fileSystem.directoryExists(at: childURL) {
                    queue.append(childURL)
                }
            }
        }
        throw CodexSetupError.invalidCodexBundle(rootURL)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let root = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-extension-install-\(UUID().uuidString)", directoryHint: .isDirectory)
        try self.fileSystem.createDirectory(at: root)
        return root
    }
}
