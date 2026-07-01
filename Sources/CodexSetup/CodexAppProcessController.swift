import Foundation

struct CodexAppProcessController: Sendable {
    private let terminator: CodexAppTerminator
    private let processRunner: CodexProcessRunner

    init(processRunner: CodexProcessRunner = CodexProcessRunner()) {
        self.processRunner = processRunner
        self.terminator = CodexAppTerminator(processRunner: processRunner)
    }

    func isRunning(appURL: URL, bundleIdentifier: String?) -> Bool {
        self.terminator.isRunning(appURL: appURL, bundleIdentifier: bundleIdentifier)
    }

    func quit(appURL: URL, bundleIdentifier: String?) throws {
        try self.terminator.quit(appURL: appURL, bundleIdentifier: bundleIdentifier)
    }

    func launch(appURL: URL) throws {
        _ = try self.processRunner.run("/usr/bin/open", arguments: [appURL.path])
    }
}

struct CodexAppTerminator: Sendable {
    private let processRunner: CodexProcessRunner

    init(processRunner: CodexProcessRunner = CodexProcessRunner()) {
        self.processRunner = processRunner
    }

    func isRunning(appURL: URL, bundleIdentifier: String?) -> Bool {
        !self.runningProcessIDs(appURL: appURL).isEmpty || self.isRegisteredWithLaunchServices(bundleIdentifier: bundleIdentifier)
    }

    func quit(appURL: URL, bundleIdentifier: String?) throws {
        if let bundleIdentifier, !bundleIdentifier.isEmpty {
            _ = try? self.processRunner.run(
                "/usr/bin/osascript",
                arguments: ["-e", "tell application id \"\(bundleIdentifier)\" to quit"]
            )
        }

        if self.waitUntilClosed(appURL: appURL, bundleIdentifier: bundleIdentifier, timeout: 2) {
            return
        }

        self.killLaunchServicesApplication(bundleIdentifier: bundleIdentifier, hard: false)
        if self.waitUntilClosed(appURL: appURL, bundleIdentifier: bundleIdentifier, timeout: 2) {
            return
        }

        self.signalRunningProcesses(appURL: appURL, signal: nil)
        if self.waitUntilClosed(appURL: appURL, bundleIdentifier: bundleIdentifier, timeout: 3) {
            return
        }

        self.killLaunchServicesApplication(bundleIdentifier: bundleIdentifier, hard: true)
        self.signalRunningProcesses(appURL: appURL, signal: "-9")
        if self.waitUntilClosed(appURL: appURL, bundleIdentifier: bundleIdentifier, timeout: 2) {
            return
        }

        throw CodexSetupError.codexStillRunning
    }

    private func waitUntilClosed(appURL: URL, bundleIdentifier: String?, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !self.isRunning(appURL: appURL, bundleIdentifier: bundleIdentifier) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return !self.isRunning(appURL: appURL, bundleIdentifier: bundleIdentifier)
    }

    private func signalRunningProcesses(appURL: URL, signal: String?) {
        let processIDs = self.runningProcessIDs(appURL: appURL).map(String.init)
        guard !processIDs.isEmpty else {
            return
        }

        let arguments = signal.map { [$0] + processIDs } ?? processIDs
        _ = try? self.processRunner.run("/bin/kill", arguments: arguments)
    }

    private func isRegisteredWithLaunchServices(bundleIdentifier: String?) -> Bool {
        !self.launchServicesApplicationSpecifiers(bundleIdentifier: bundleIdentifier, includeExitedApplications: false).isEmpty
    }

    private func killLaunchServicesApplication(bundleIdentifier: String?, hard: Bool) {
        for applicationSpecifier in self.launchServicesApplicationSpecifiers(bundleIdentifier: bundleIdentifier, includeExitedApplications: true) {
            var arguments = ["kill", "-childapps", "-coalition", "-launchdjobs", "-force"]
            if hard {
                arguments.append("-hard")
            }
            arguments.append(applicationSpecifier)
            _ = try? self.processRunner.run("/usr/bin/lsappinfo", arguments: arguments)
        }
    }

    private func launchServicesApplicationSpecifiers(bundleIdentifier: String?, includeExitedApplications: Bool) -> [String] {
        guard let bundleIdentifier, !bundleIdentifier.isEmpty,
              let result = try? self.processRunner.run(
                  "/usr/bin/lsappinfo",
                  arguments: includeExitedApplications
                    ? ["find", "--includeExitedApplications", "bundleid=\(bundleIdentifier)"]
                    : ["find", "bundleid=\(bundleIdentifier)"]
              )
        else {
            return []
        }

        return result.output
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> String? in
                guard let range = line.range(of: #"ASN:0x[0-9a-fA-F]+-0x[0-9a-fA-F]+"#, options: .regularExpression) else {
                    return nil
                }
                return "\(line[range]):"
            }
    }

    private func runningProcessIDs(appURL: URL) -> [Int32] {
        guard let result = try? self.processRunner.run("/bin/ps", arguments: ["-axo", "pid=,command="]) else {
            return []
        }

        let bundlePrefix = appURL.standardizedFileURL.path + "/Contents/"
        return result.output
            .split(whereSeparator: \.isNewline)
            .compactMap { line in
                let text = String(line)
                guard text.contains(bundlePrefix) else {
                    return nil
                }
                return Int32(text.trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "")
            }
            .filter { $0 != getpid() }
    }
}
