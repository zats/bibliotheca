import Foundation

struct CodexAppInstaller: Sendable {
    private let fileSystem: BibliothecaSetupFileSystem
    private let processRunner: CodexProcessRunner
    private let urlSession: URLSession

    init(
        fileSystem: BibliothecaSetupFileSystem,
        processRunner: CodexProcessRunner = CodexProcessRunner(),
        urlSession: URLSession = .shared
    ) {
        self.fileSystem = fileSystem
        self.processRunner = processRunner
        self.urlSession = urlSession
    }

    func installCleanCodex(
        from update: CodexUpdateInfo,
        replacing appURL: URL,
        progress: CodexRestoreProgressHandler = { _ in }
    ) async throws {
        guard let downloadURL = update.downloadURL else {
            throw BibliothecaSetupError.updateFeedMalformed
        }

        await progress(CodexRestoreProgress(phase: .preparing, fraction: 0.02, detail: "Preparing restore"))
        try? self.cleanStaleTemporaryInstallDirectories()
        let temporaryRoot = try self.makeTemporaryDirectory()
        defer { try? self.fileSystem.removeItem(at: temporaryRoot) }

        let downloadedURL = temporaryRoot.appending(path: downloadURL.lastPathComponent.isEmpty ? "CodexUpdate" : downloadURL.lastPathComponent)
        try await self.download(downloadURL, to: downloadedURL, progress: progress)
        await progress(CodexRestoreProgress(phase: .validating, fraction: 0.66, detail: "Validating download"))
        try self.validateArchive(at: downloadedURL, downloadURL: downloadURL)

        await progress(CodexRestoreProgress(phase: .extracting, fraction: 0.68, detail: "Extracting Codex"))
        let cleanAppURL = try await self.extractApp(from: downloadedURL, temporaryRoot: temporaryRoot, progress: progress)
        let stagingRootURL = self.stagingRootURL(for: appURL)
        let stagedAppURL = stagingRootURL.appending(path: appURL.lastPathComponent, directoryHint: .isDirectory)
        try self.cleanStaleRestoreItems(appURL: appURL, stagingRootURL: stagingRootURL)
        await progress(CodexRestoreProgress(phase: .replacing, fraction: 0.88, detail: "Staging clean Codex"))
        try self.fileSystem.copyItem(at: cleanAppURL, to: stagedAppURL)

        if self.fileSystem.directoryExists(at: appURL) {
            let backupName = ".bibliotheca-restore-backup-\(UUID().uuidString).app"
            await progress(CodexRestoreProgress(phase: .replacing, fraction: 0.94, detail: "Installing clean Codex"))
            try self.fileSystem.replaceItem(at: appURL, withItemAt: stagedAppURL, backupItemName: backupName)
            let backupURL = appURL.deletingLastPathComponent().appending(path: backupName, directoryHint: .isDirectory)
            try? self.fileSystem.removeItem(at: backupURL)
        } else {
            await progress(CodexRestoreProgress(phase: .replacing, fraction: 0.94, detail: "Installing clean Codex"))
            try self.fileSystem.moveItem(at: stagedAppURL, to: appURL)
        }
        try? self.fileSystem.removeItem(at: stagingRootURL)
        await progress(CodexRestoreProgress(phase: .cleaningUp, fraction: 0.98, detail: "Cleaning up"))
        await progress(CodexRestoreProgress(phase: .complete, fraction: 1, detail: "Restore complete"))
    }

    private func download(_ sourceURL: URL, to destinationURL: URL, progress: CodexRestoreProgressHandler) async throws {
        if let aria2URL = self.aria2ExecutableURL() {
            try await self.downloadWithAria2(sourceURL, to: destinationURL, aria2URL: aria2URL, progress: progress)
            return
        }

        try await self.downloadWithURLSession(sourceURL, to: destinationURL, progress: progress)
    }

    private func downloadWithURLSession(_ sourceURL: URL, to destinationURL: URL, progress: CodexRestoreProgressHandler) async throws {
        let (bytes, response) = try await self.urlSession.bytes(from: sourceURL)
        let expectedBytes = response.expectedContentLength
        FileManager.default.createFile(atPath: destinationURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destinationURL)
        defer { try? handle.close() }

        var downloadedBytes: Int64 = 0
        var buffer: [UInt8] = []
        buffer.reserveCapacity(64 * 1024)
        await progress(CodexRestoreProgress(phase: .downloading, fraction: 0.05, detail: "Downloading Codex"))

        for try await byte in bytes {
            buffer.append(byte)
            downloadedBytes += 1
            if buffer.count >= 64 * 1024 {
                try handle.write(contentsOf: Data(buffer))
                buffer.removeAll(keepingCapacity: true)
                await self.reportDownloadProgress(downloadedBytes: downloadedBytes, expectedBytes: expectedBytes, progress: progress)
            }
        }

        if !buffer.isEmpty {
            try handle.write(contentsOf: Data(buffer))
        }
        await progress(CodexRestoreProgress(phase: .downloading, fraction: 0.65, detail: "Download complete"))
    }

    private func downloadWithAria2(
        _ sourceURL: URL,
        to destinationURL: URL,
        aria2URL: URL,
        progress: CodexRestoreProgressHandler
    ) async throws {
        let expectedBytes = (try? await self.expectedContentLength(for: sourceURL)) ?? 0
        let process = Process()
        let outputPipe = Pipe()
        process.executableURL = aria2URL
        process.arguments = [
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "--continue=false",
            "--console-log-level=warn",
            "--dir", destinationURL.deletingLastPathComponent().path,
            "--download-result=hide",
            "--file-allocation=none",
            "--max-connection-per-server=8",
            "--min-split-size=8M",
            "--out", destinationURL.lastPathComponent,
            "--show-console-readout=false",
            "--split=8",
            sourceURL.absoluteString,
        ]
        process.standardOutput = outputPipe
        process.standardError = outputPipe

        await progress(CodexRestoreProgress(phase: .downloading, fraction: 0.05, detail: "Downloading Codex with aria2c"))
        try process.run()

        do {
            while process.isRunning {
                try Task.checkCancellation()
                await self.reportDownloadProgress(downloadedBytes: self.fileSize(at: destinationURL), expectedBytes: expectedBytes, progress: progress, suffix: " (aria2c)")
                try await Task.sleep(for: .milliseconds(500))
            }
        } catch {
            if process.isRunning {
                process.terminate()
            }
            throw error
        }

        let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let output = String(data: data, encoding: .utf8) ?? ""
            throw BibliothecaSetupError.processFailed(executable: aria2URL.path, status: process.terminationStatus, output: output)
        }
        await progress(CodexRestoreProgress(phase: .downloading, fraction: 0.65, detail: "Download complete"))
    }

    private func expectedContentLength(for sourceURL: URL) async throws -> Int64 {
        var request = URLRequest(url: sourceURL)
        request.httpMethod = "HEAD"
        let (_, response) = try await self.urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              200..<300 ~= httpResponse.statusCode
        else {
            throw BibliothecaSetupError.updateDownloadInvalid(sourceURL)
        }
        return response.expectedContentLength
    }

    private func reportDownloadProgress(downloadedBytes: Int64, expectedBytes: Int64, progress: CodexRestoreProgressHandler, suffix: String = "") async {
        guard expectedBytes > 0 else {
            await progress(CodexRestoreProgress(phase: .downloading, fraction: 0.12, detail: "Downloading Codex"))
            return
        }

        let downloadFraction = min(1, Double(downloadedBytes) / Double(expectedBytes))
        let totalFraction = 0.05 + (downloadFraction * 0.60)
        await progress(CodexRestoreProgress(
            phase: .downloading,
            fraction: totalFraction,
            detail: "Downloading \(Self.byteCount(downloadedBytes)) of \(Self.byteCount(expectedBytes))\(suffix)"
        ))
    }

    private func aria2ExecutableURL() -> URL? {
        let pathCandidates = self.environmentPathCandidates()
            + [
                Bundle.main.resourceURL?.appending(path: "aria2c").path,
                Bundle.module.resourceURL?.appending(path: "aria2c").path,
                "/opt/homebrew/bin/aria2c",
                "/usr/local/bin/aria2c",
            ].compactMap { $0 }
        return pathCandidates
            .map { URL(filePath: $0) }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private func environmentPathCandidates() -> [String] {
        (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map { URL(filePath: String($0)).appending(path: "aria2c").path }
    }

    private func fileSize(at url: URL) -> Int64 {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.size] as? Int64 ?? 0
    }

    private func stagingRootURL(for appURL: URL) -> URL {
        appURL.deletingLastPathComponent().appending(path: ".bibliotheca-restore", directoryHint: .isDirectory)
    }

    private func cleanStaleRestoreItems(appURL: URL, stagingRootURL: URL) throws {
        try self.fileSystem.removeItem(at: stagingRootURL)
        let appDirectoryURL = appURL.deletingLastPathComponent()
        for itemURL in try self.fileSystem.contentsOfDirectory(at: appDirectoryURL) {
            if itemURL.lastPathComponent.hasPrefix(".bibliotheca-restore-backup-") {
                try self.fileSystem.removeItem(at: itemURL)
            }
        }
    }

    private func extractApp(from archiveURL: URL, temporaryRoot: URL, progress: CodexRestoreProgressHandler) async throws -> URL {
        let extractURL = temporaryRoot.appending(path: "extract", directoryHint: .isDirectory)
        try self.fileSystem.createDirectory(at: extractURL)

        if archiveURL.pathExtension.lowercased() == "dmg" {
            let appURL = try self.extractDMG(archiveURL, temporaryRoot: temporaryRoot)
            await progress(CodexRestoreProgress(phase: .extracting, fraction: 0.85, detail: "Extracted Codex"))
            return appURL
        }

        _ = try self.processRunner.run("/usr/bin/ditto", arguments: ["-x", "-k", archiveURL.path, extractURL.path])
        let appURL = try self.findCodexApp(in: extractURL)
        await progress(CodexRestoreProgress(phase: .extracting, fraction: 0.85, detail: "Extracted Codex"))
        return appURL
    }

    private func validateArchive(at archiveURL: URL, downloadURL: URL) throws {
        let handle = try FileHandle(forReadingFrom: archiveURL)
        let data = try handle.read(upToCount: 4096) ?? Data()
        try handle.close()
        if data.starts(with: [0x50, 0x4B, 0x03, 0x04])
            || data.starts(with: [0x50, 0x4B, 0x05, 0x06])
            || data.starts(with: [0x78, 0x01])
            || data.starts(with: [0x78, 0x9C])
            || data.starts(with: [0x78, 0xDA]) {
            return
        }

        if archiveURL.pathExtension.lowercased() == "dmg" {
            return
        }

        throw BibliothecaSetupError.updateDownloadInvalid(downloadURL)
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
            throw BibliothecaSetupError.updateFeedMalformed
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
        throw BibliothecaSetupError.invalidCodexBundle(rootURL)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let root = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "bibliotheca-install-\(UUID().uuidString)", directoryHint: .isDirectory)
        try self.fileSystem.createDirectory(at: root)
        return root
    }

    private func cleanStaleTemporaryInstallDirectories() throws {
        let root = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
        for itemURL in try self.fileSystem.contentsOfDirectory(at: root) {
            if itemURL.lastPathComponent.hasPrefix("bibliotheca-install-") {
                try self.fileSystem.removeItem(at: itemURL)
            }
        }
    }

    private static func byteCount(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }
}
