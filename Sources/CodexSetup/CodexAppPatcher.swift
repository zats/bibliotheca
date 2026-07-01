import CryptoKit
import Foundation

struct CodexPatchResult: Sendable {
    var cleanAppASARSHA256: String
    var patchedAppASARSHA256: String
    var backupDirectoryURL: URL
}

struct CodexAppPatcher: Sendable {
    private let fileSystem: CodexSetupFileSystem
    private let asarIdentityCache: CodexASARIdentityCache
    private let processRunner: CodexProcessRunner
    private let toolLocator: CodexToolLocator

    init(
        fileSystem: CodexSetupFileSystem,
        asarIdentityCache: CodexASARIdentityCache = CodexASARIdentityCache(),
        processRunner: CodexProcessRunner = CodexProcessRunner()
    ) {
        self.fileSystem = fileSystem
        self.asarIdentityCache = asarIdentityCache
        self.processRunner = processRunner
        self.toolLocator = CodexToolLocator(fileSystem: fileSystem)
    }

    func patch(appURL: URL, appVersion: String, backupRootURL: URL) throws -> CodexPatchResult {
        let resourcesURL = appURL.appending(path: "Contents/Resources", directoryHint: .isDirectory)
        let infoURL = appURL.appending(path: "Contents/Info.plist")
        let asarURL = resourcesURL.appending(path: "app.asar")
        let cleanHash = try self.asarIdentityHash(at: asarURL)
        let backupURL = backupRootURL.appending(path: "\(appVersion)-\(cleanHash.prefix(12))", directoryHint: .isDirectory)

        try self.fileSystem.createDirectory(at: backupURL)
        try self.fileSystem.writeData(try self.fileSystem.readData(at: asarURL), to: backupURL.appending(path: "app.asar"))
        try self.fileSystem.writeData(try self.fileSystem.readData(at: infoURL), to: backupURL.appending(path: "Info.plist"))

        do {
            let temporaryRoot = try self.makeTemporaryDirectory()
            defer { try? self.fileSystem.removeItem(at: temporaryRoot) }

            let extractURL = temporaryRoot.appending(path: "extract", directoryHint: .isDirectory)
            let patchedAsarURL = temporaryRoot.appending(path: "app.asar")
            let patchedInfoURL = temporaryRoot.appending(path: "Info.plist")
            try self.fileSystem.createDirectory(at: extractURL)

            let asar = try self.toolLocator.asarCommand()
            _ = try self.runAsar(asar, arguments: ["extract", asarURL.path, extractURL.path])
            try self.patchPreload(in: extractURL, appVersion: appVersion)
            try self.patchMain(in: extractURL)
            _ = try self.runAsar(asar, arguments: ["pack", extractURL.path, patchedAsarURL.path])
            try self.fileSystem.writeData(
                try self.electronAsarIntegrityInfoData(infoURL: infoURL, asarURL: patchedAsarURL),
                to: patchedInfoURL
            )

            try self.installFilesAndSign(
                files: [
                    (source: patchedAsarURL, destination: asarURL),
                    (source: patchedInfoURL, destination: infoURL),
                ],
                appURL: appURL,
                rollbackFiles: [
                    (source: backupURL.appending(path: "app.asar"), destination: asarURL),
                    (source: backupURL.appending(path: "Info.plist"), destination: infoURL),
                ]
            )

            return CodexPatchResult(
                cleanAppASARSHA256: cleanHash,
                patchedAppASARSHA256: try self.asarIdentityHash(at: asarURL),
                backupDirectoryURL: backupURL
            )
        } catch {
            try? self.fileSystem.removeItem(at: backupURL)
            throw error
        }
    }

    func rollback(appURL: URL, backupDirectoryURL: URL) throws {
        let backupAsarURL = backupDirectoryURL.appending(path: "app.asar")
        let backupInfoURL = backupDirectoryURL.appending(path: "Info.plist")

        guard self.fileSystem.fileExists(at: backupAsarURL), self.fileSystem.fileExists(at: backupInfoURL) else {
            throw CodexSetupError.rollbackBackupMissing
        }

        try self.installFilesAndSign(
            files: [
                (source: backupAsarURL, destination: appURL.appending(path: "Contents/Resources/app.asar")),
                (source: backupInfoURL, destination: appURL.appending(path: "Contents/Info.plist")),
            ],
            appURL: appURL,
            rollbackFiles: []
        )
    }

    private func asarIdentityHash(at url: URL) throws -> String {
        try self.asarIdentityCache.identity(at: url, fileSystem: self.fileSystem).hash
    }

    private func patchPreload(in rootURL: URL, appVersion: String) throws {
        let preloadURL = rootURL.appending(path: ".vite/build/preload.js")
        var source = try self.text(at: preloadURL)
        if source.contains("codex_desktop:extensions-bootloader-preload-source") {
            return
        }

        let electronVariable = try self.firstCapture(
            pattern: #"([A-Za-z_$][A-Za-z0-9_$]*)\.contextBridge\.exposeInMainWorld\(`codexWindowType`"#,
            source: source,
            description: "preload electron bridge"
        )
        let bridgeVariable = try self.firstCapture(
            pattern: #",([A-Za-z_$][A-Za-z0-9_$]*)=\{windowType:"#,
            source: source,
            description: "preload bridge object"
        )
        let marker = "\(electronVariable).contextBridge.exposeInMainWorld(`codexWindowType`"
        let hook = """
        (()=>{try{let __s=\(electronVariable).ipcRenderer.sendSync(`codex_desktop:extensions-bootloader-preload-source`,"\(appVersion)");if(__s){let __m={exports:{}};let __c={electron:\(electronVariable),ipcRenderer:\(electronVariable).ipcRenderer,bridge:\(bridgeVariable),appVersion:"\(appVersion)"};let __r=new Function(`module`,`exports`,`context`,`${__s}\\n;return module.exports;`)(__m,__m.exports,__c);typeof __r.activate===`function`&&__r.activate(__c)}}catch(e){console.error(`[codex-ext] preload bootloader failed`,e)}})(),
        """

        guard let range = source.range(of: marker) else {
            throw CodexSetupError.patchPatternMissing("preload activation point")
        }
        source.insert(contentsOf: hook, at: range.lowerBound)
        try self.writeText(source, to: preloadURL)
    }

    private func patchMain(in rootURL: URL) throws {
        let mainURL = try self.mainBundleURL(in: rootURL)
        var source = try self.text(at: mainURL)
        if source.contains("main bootloader failed") {
            return
        }

        let insertion = try self.mainInsertion(source: source)
        source.replaceSubrange(insertion.range, with: insertion.replacement)
        try self.writeText(source, to: mainURL)
    }

    private func mainBundleURL(in rootURL: URL) throws -> URL {
        let buildURL = rootURL.appending(path: ".vite/build", directoryHint: .isDirectory)
        for fileURL in try self.fileSystem.contentsOfDirectory(at: buildURL) where fileURL.pathExtension == "js" {
            let source = (try? self.text(at: fileURL)) ?? ""
            if source.contains(".app.getVersion()") && source.contains(".ipcMain") {
                return fileURL
            }
        }
        throw CodexSetupError.patchPatternMissing("main bundle")
    }

    private func mainInsertion(source: String) throws -> (range: Range<String.Index>, replacement: String) {
        let hook = """
        (()=>{try{let __e=require(`electron`);require(require(`node:path`).join(require(`node:os`).homedir(),`.codex`,`extensions`,`bootloader`,`src`,`main.js`)).activate({electron:__e,appVersion:__e.app.getVersion()})}catch(e){console.error(`[codex-ext] main bootloader failed`,e)}})();
        """
        return (source.startIndex..<source.startIndex, hook)
    }

    private func electronAsarIntegrityInfoData(infoURL: URL, asarURL: URL) throws -> Data {
        let data = try self.fileSystem.readData(at: infoURL)
        guard var plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] else {
            throw CodexSetupError.invalidCodexBundle(infoURL)
        }

        plist["ElectronAsarIntegrity"] = [
            "Resources/app.asar": [
                "algorithm": "SHA256",
                "hash": try self.asarHeaderHash(asarURL: asarURL),
            ],
        ]

        return try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
    }

    private func installFilesAndSign(
        files: [(source: URL, destination: URL)],
        appURL: URL,
        rollbackFiles: [(source: URL, destination: URL)]
    ) throws {
        do {
            try self.installFiles(files)
            try self.sign(appURL)
        } catch {
            if !rollbackFiles.isEmpty {
                try? self.installFiles(rollbackFiles)
                try? self.sign(appURL)
            }
            throw error
        }
    }

    private func installFiles(_ files: [(source: URL, destination: URL)]) throws {
        for file in files {
            do {
                _ = try self.processRunner.run("/usr/bin/ditto", arguments: [file.source.path, file.destination.path])
                self.asarIdentityCache.invalidate(at: file.destination)
            } catch {
                throw self.appManagementErrorIfNeeded(error)
            }
        }
    }

    private func sign(_ appURL: URL) throws {
        do {
            _ = try self.processRunner.run("/usr/bin/codesign", arguments: ["--force", "--deep", "--sign", "-", appURL.path])
        } catch {
            throw self.appManagementErrorIfNeeded(error)
        }
    }

    private func appManagementErrorIfNeeded(_ error: Error) -> Error {
        guard case CodexSetupError.processFailed(_, _, let output) = error else {
            return error
        }

        let lowercasedOutput = output.lowercased()
        if lowercasedOutput.contains("operation not permitted")
            || lowercasedOutput.contains("permission")
            || lowercasedOutput.contains("not allowed")
            || lowercasedOutput.contains("couldn't be moved") {
            return CodexSetupError.appManagementPermissionRequired
        }
        return error
    }

    private func asarHeaderHash(asarURL: URL) throws -> String {
        let data = try self.fileSystem.readData(at: asarURL)
        guard data.count >= 16 else {
            throw CodexSetupError.invalidCodexBundle(asarURL)
        }

        let headerSize = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self).littleEndian })
        guard data.count >= 8 + headerSize, headerSize >= 8 else {
            throw CodexSetupError.invalidCodexBundle(asarURL)
        }

        let header = data.subdata(in: 8..<(8 + headerSize))
        let stringSize = Int(header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self).littleEndian })
        guard header.count >= 8 + stringSize else {
            throw CodexSetupError.invalidCodexBundle(asarURL)
        }

        let headerString = header.subdata(in: 8..<(8 + stringSize))
        return SHA256.hash(data: headerString).map { String(format: "%02x", $0) }.joined()
    }

    private func firstCapture(pattern: String, source: String, description: String) throws -> String {
        let regex = try NSRegularExpression(pattern: pattern)
        let nsRange = NSRange(source.startIndex..<source.endIndex, in: source)
        guard let match = regex.firstMatch(in: source, range: nsRange),
              let value = self.capture(1, match: match, source: source)
        else {
            throw CodexSetupError.patchPatternMissing(description)
        }
        return value
    }

    private func capture(_ index: Int, match: NSTextCheckingResult, source: String) -> String? {
        guard match.range(at: index).location != NSNotFound,
              let range = Range(match.range(at: index), in: source)
        else {
            return nil
        }
        return String(source[range])
    }

    private func text(at url: URL) throws -> String {
        guard let text = String(data: try self.fileSystem.readData(at: url), encoding: .utf8) else {
            throw CodexSetupError.invalidCodexBundle(url)
        }
        return text
    }

    private func writeText(_ text: String, to url: URL) throws {
        try self.fileSystem.writeData(Data(text.utf8), to: url)
    }

    private func runAsar(_ command: AsarCommand, arguments: [String]) throws -> CodexProcessResult {
        try self.processRunner.run(
            command.executable.path,
            arguments: command.arguments + arguments,
            environment: command.environment
        )
    }

    private func makeTemporaryDirectory() throws -> URL {
        let root = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-extension-\(UUID().uuidString)", directoryHint: .isDirectory)
        try self.fileSystem.createDirectory(at: root)
        return root
    }

}
