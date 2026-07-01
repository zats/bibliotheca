import Foundation

struct CodexPatchInspector: Sendable {
    private let fileSystem: CodexSetupFileSystem
    private let markers: [Data]

    init(fileSystem: CodexSetupFileSystem) {
        self.fileSystem = fileSystem
        self.markers = [
            "codex_desktop:extensions-bootloader-preload-source",
            "main bootloader failed",
            ".codex",
            "bootloader",
        ].map { Data($0.utf8) }
    }

    func isPatched(appURL: URL) throws -> Bool {
        let asarURL = appURL.appending(path: "Contents/Resources/app.asar")
        return try self.isPatchedASAR(at: asarURL)
    }

    func isPatchedASAR(at asarURL: URL) throws -> Bool {
        let data = try self.fileSystem.readData(at: asarURL)
        return self.markers.allSatisfy { data.range(of: $0) != nil }
    }
}
