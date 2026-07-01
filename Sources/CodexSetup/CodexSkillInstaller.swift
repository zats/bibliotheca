import Foundation

struct CodexSkillInstaller: Sendable {
    private let fileSystem: CodexSetupFileSystem

    init(fileSystem: CodexSetupFileSystem) {
        self.fileSystem = fileSystem
    }

    func installBundledSkills(from bundledRootURL: URL, to destinationRootURL: URL) throws {
        guard self.fileSystem.directoryExists(at: bundledRootURL) else {
            throw CodexSetupError.bundledSkillsMissing(bundledRootURL)
        }

        try self.fileSystem.createDirectory(at: destinationRootURL)

        for sourceSkillURL in try self.fileSystem.contentsOfDirectory(at: bundledRootURL) {
            let skillFileURL = sourceSkillURL.appending(path: "SKILL.md")
            guard self.fileSystem.directoryExists(at: sourceSkillURL),
                  self.fileSystem.fileExists(at: skillFileURL)
            else {
                continue
            }

            let destinationSkillURL = destinationRootURL.appending(
                path: sourceSkillURL.lastPathComponent,
                directoryHint: .isDirectory
            )
            try self.fileSystem.copyItem(at: sourceSkillURL, to: destinationSkillURL)
        }
    }
}
