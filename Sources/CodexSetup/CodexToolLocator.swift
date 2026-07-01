import Foundation

struct CodexToolLocator: Sendable {
    private let fileSystem: CodexSetupFileSystem

    init(fileSystem: CodexSetupFileSystem) {
        self.fileSystem = fileSystem
    }

    func asarCommand() throws -> AsarCommand {
        guard let asarURL = self.findExecutable(named: "asar", overrideEnvironmentKey: "CODEX_EXTENSION_ASAR") else {
            throw CodexSetupError.asarToolMissing
        }

        let environment = self.toolEnvironment()
        if let nodeURL = self.findExecutable(named: "node", overrideEnvironmentKey: "CODEX_EXTENSION_NODE") {
            return AsarCommand(executable: nodeURL, arguments: [asarURL.path], environment: environment)
        }

        return AsarCommand(executable: asarURL, arguments: [], environment: environment)
    }

    private func findExecutable(named name: String, overrideEnvironmentKey: String) -> URL? {
        if let override = ProcessInfo.processInfo.environment[overrideEnvironmentKey], !override.isEmpty {
            let url = URL(filePath: override)
            return self.isExecutable(url) ? url : nil
        }

        for directory in self.searchDirectories() {
            let url = URL(filePath: directory, directoryHint: .isDirectory).appending(path: name)
            if self.isExecutable(url) {
                return url
            }
        }
        return nil
    }

    private func toolEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = self.searchDirectories().joined(separator: ":")
        return environment
    }

    private func searchDirectories() -> [String] {
        let pathDirectories = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let fallbackDirectories = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        var seen = Set<String>()
        return (pathDirectories + fallbackDirectories).filter { directory in
            !directory.isEmpty && seen.insert(directory).inserted
        }
    }

    private func isExecutable(_ url: URL) -> Bool {
        self.fileSystem.fileExists(at: url) && FileManager.default.isExecutableFile(atPath: url.path)
    }
}
