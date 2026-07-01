import Foundation
import Testing
@testable import BibliothecaSetup

@Suite
struct CodexSkillInstallerTests {
    @Test
    func installsBundledSkillTree() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let installer = CodexSkillInstaller(fileSystem: fileSystem)
        let bundledRootURL = rootURL.appending(path: "bundled", directoryHint: .isDirectory)
        let skillsRootURL = rootURL.appending(path: "skills", directoryHint: .isDirectory)
        let scriptURL = bundledRootURL.appending(path: "codex-app-modifier/scripts/mod_codex_app.sh")
        try Self.writeFile("Use this skill.", to: bundledRootURL.appending(path: "codex-app-modifier/SKILL.md"))
        try Self.writeFile("model: gpt-5", to: bundledRootURL.appending(path: "codex-app-modifier/agents/openai.yaml"))
        try Self.writeFile("#!/usr/bin/env bash\n", to: scriptURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)

        try installer.installBundledSkills(from: bundledRootURL, to: skillsRootURL)

        #expect(fileSystem.fileExists(at: skillsRootURL.appending(path: "codex-app-modifier/SKILL.md")))
        #expect(fileSystem.fileExists(at: skillsRootURL.appending(path: "codex-app-modifier/agents/openai.yaml")))
        let attributes = try FileManager.default.attributesOfItem(
            atPath: skillsRootURL.appending(path: "codex-app-modifier/scripts/mod_codex_app.sh").path
        )
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o755)
    }

    @Test
    func reinstallReplacesBundledSkill() throws {
        let rootURL = try Self.makeRoot()
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let fileSystem = LocalBibliothecaSetupFileSystem()
        let installer = CodexSkillInstaller(fileSystem: fileSystem)
        let bundledRootURL = rootURL.appending(path: "bundled", directoryHint: .isDirectory)
        let skillsRootURL = rootURL.appending(path: "skills", directoryHint: .isDirectory)
        let destinationSkillURL = skillsRootURL.appending(path: "codex-app-modifier", directoryHint: .isDirectory)
        try Self.writeFile("old", to: destinationSkillURL.appending(path: "SKILL.md"))
        try Self.writeFile("stale", to: destinationSkillURL.appending(path: "stale.txt"))
        try Self.writeFile("new", to: bundledRootURL.appending(path: "codex-app-modifier/SKILL.md"))

        try installer.installBundledSkills(from: bundledRootURL, to: skillsRootURL)

        let installed = try String(contentsOf: destinationSkillURL.appending(path: "SKILL.md"), encoding: .utf8)
        #expect(installed == "new")
        #expect(!fileSystem.fileExists(at: destinationSkillURL.appending(path: "stale.txt")))
    }

    private static func makeRoot() throws -> URL {
        let rootURL = URL(filePath: NSTemporaryDirectory(), directoryHint: .isDirectory)
            .appending(path: "codex-skill-installer-test-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        return rootURL
    }

    private static func writeFile(_ text: String, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try text.write(to: url, atomically: true, encoding: .utf8)
    }
}
