import CodexSetup
import Foundation

@main
struct CodexSetupCLI {
    static func main() async {
        do {
            try await Self.run(arguments: Array(CommandLine.arguments.dropFirst()))
        } catch {
            FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    private static func run(arguments: [String]) async throws {
        var parser = ArgumentParser(arguments)
        let command = parser.command()
        let appURL = parser.option("--app").map { URL(filePath: $0, directoryHint: .isDirectory) }
        let version = parser.option("--version")
        let runtime = CodexSetupRuntime()

        switch command {
        case "status":
            let snapshot = await runtime.inspect(appURL: appURL, checkForUpdates: parser.flag("--updates"))
            Self.printSnapshot(snapshot)
        case "install-extensions":
            Self.printProgress("installing extensions")
            try await runtime.installBundledExtensionsDisabled(appURL: appURL)
            Swift.print("installed extensions disabled")
        case "patch":
            Self.printProgress("patching Codex")
            try await runtime.patchCodex(appURL: appURL)
            Swift.print("patched")
        case "rollback":
            Self.printProgress("rolling back Codex")
            try await runtime.rollbackCodex(appURL: appURL)
            Swift.print("rolled back")
        case "restore-versions":
            let options = try await runtime.availableRestoreOptions(appURL: appURL)
            for option in options {
                Swift.print("\(option.title)\t\(option.downloadURL?.absoluteString ?? "missing-url")")
            }
        case "restore-clean":
            let options = try await runtime.availableRestoreOptions(appURL: appURL)
            guard let option = version.flatMap({ requested in options.first { $0.version == requested } }) ?? options.first else {
                throw CLIError.noRestoreVersion
            }
            Self.printProgress("restoring Codex \(option.version)")
            try await runtime.restoreCleanCodex(
                option,
                appURL: appURL,
                progress: { progress in
                    FileHandle.standardError.write(Data("\(progress.percent)% \(progress.detail)\n".utf8))
                }
            )
            Swift.print("restored Codex \(option.version)")
        case "quit-codex":
            Self.printProgress("quitting Codex")
            try await runtime.quitCodex(appURL: appURL)
            Swift.print("quit Codex")
        case "launch-codex":
            Self.printProgress("launching Codex")
            try await runtime.launchCodex(appURL: appURL)
            Swift.print("launched Codex")
        case "prune-backups":
            Self.printProgress("pruning backups")
            try await runtime.prunePatchBackups(appURL: appURL)
            Swift.print("pruned backups")
        case "repair":
            Self.printProgress("repairing Codex")
            try await runtime.repairFromLatestCodex(appURL: appURL)
            Swift.print("repaired from latest")
        case "uninstall":
            Self.printProgress("uninstalling Codex Extension")
            try await runtime.uninstallCodexExtension(appURL: appURL)
            Swift.print("uninstalled")
        case "next":
            let action = try await runtime.performRecommendedAction(appURL: appURL)
            Swift.print("performed \(action)")
            if action == .openCodexDownloadPage {
                Swift.print("download: https://developers.openai.com/codex/app")
            }
        case "help", nil:
            Self.printHelp()
        default:
            throw CLIError.unknownCommand(command ?? "")
        }
    }

    private static func printSnapshot(_ snapshot: CodexSetupSnapshot) {
        Swift.print("app: \(snapshot.appURL?.path ?? "missing")")
        Swift.print("version: \(snapshot.appIdentity?.version.displayString ?? "unknown")")
        Swift.print("patch: \(Self.describe(snapshot.patchState))")
        Swift.print("app-management: \(Self.describe(snapshot.appManagementPermissionGranted))")
        Swift.print("codex-running: \(snapshot.isCodexRunning ? "yes" : "no")")
        Swift.print("extensions: \(Self.describe(snapshot.extensionStoreStatus))")
        Swift.print("latest: \(snapshot.latestCodexUpdate?.version ?? "not checked")")
        Swift.print("action: \(snapshot.recommendedAction)")
    }

    private static func printProgress(_ message: String) {
        FileHandle.standardError.write(Data("\(message)...\n".utf8))
    }

    private static func describe(_ state: CodexPatchState) -> String {
        switch state {
        case .missingApp:
            return "missing app"
        case .clean:
            return "clean"
        case .patched:
            return "patched"
        case .updatedAfterProvisioning(let previousVersion, let currentVersion):
            return "updated after provisioning \(previousVersion) -> \(currentVersion)"
        case .damagedPatchedApp:
            return "damaged patched app"
        case .unknown(let value):
            return "unknown \(value)"
        }
    }

    private static func describe(_ status: CodexExtensionStoreStatus) -> String {
        if !status.exists {
            return "missing"
        }
        let required = status.requiredExtensionsEnabled ? "manager enabled" : "manager disabled"
        return "\(status.extensionIDs.count) installed, \(status.disabledExtensionIDs.count) disabled, \(required)"
    }

    private static func describe(_ granted: Bool?) -> String {
        switch granted {
        case true:
            return "allowed"
        case false:
            return "required"
        case nil:
            return "unknown"
        }
    }

    private static func printHelp() {
        Swift.print("""
        usage: codex-extension-setup <command> [--app /Applications/Codex.app]

        commands:
          status [--updates]
          install-extensions
          patch
          rollback
          restore-versions
          restore-clean [--version version]
          quit-codex
          launch-codex
          prune-backups
          repair
          uninstall
          next
        """)
    }
}

private struct ArgumentParser {
    private var arguments: [String]

    init(_ arguments: [String]) {
        self.arguments = arguments
    }

    mutating func command() -> String? {
        guard let first = self.arguments.first, !first.hasPrefix("--") else {
            return nil
        }
        self.arguments.removeFirst()
        return first
    }

    mutating func option(_ name: String) -> String? {
        guard let index = self.arguments.firstIndex(of: name),
              self.arguments.indices.contains(index + 1)
        else {
            return nil
        }
        let value = self.arguments[index + 1]
        self.arguments.remove(at: index + 1)
        self.arguments.remove(at: index)
        return value
    }

    mutating func flag(_ name: String) -> Bool {
        guard let index = self.arguments.firstIndex(of: name) else {
            return false
        }
        self.arguments.remove(at: index)
        return true
    }
}

private enum CLIError: LocalizedError {
    case unknownCommand(String)
    case noRestoreVersion

    var errorDescription: String? {
        switch self {
        case .unknownCommand(let command):
            "Unknown command: \(command)"
        case .noRestoreVersion:
            "No restore version is available."
        }
    }
}
