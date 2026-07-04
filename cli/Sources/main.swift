import ArgumentParser
import Foundation

@main
struct Bibliotheca: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "bibliotheca",
        abstract: "Codex extension companion CLI.",
        subcommands: [
            IsPatched.self,
            Patch.self,
            Launch.self,
        ]
    )
}

struct Patch: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "patch",
        abstract: "Patches a Codex app bundle in place."
    )

    @OptionGroup var options: CodexAppOptions

    @Option(help: .hidden)
    var patcherPath: String = "extensions/infrastructure/patch-modified-app.js"

    func run() throws {
        let app = try options.app
        let patcherURL = resolvePath(patcherPath)
        guard FileManager.default.fileExists(atPath: patcherURL.path) else {
            try printJSON(PatchResponse(
                patched: false,
                codexAppPath: app.path.path,
                codexVersion: app.metadata().codexVersion,
                patchPackVersion: nil,
                extensionApiVersion: nil,
                error: CommandErrorInfo(
                    phase: "patch",
                    message: "Patcher script not found: \(patcherURL.path)"
                )
            ))
            throw ExitCode.failure
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", patcherURL.path]
        var environment = ProcessInfo.processInfo.environment
        environment["BIBLIOTHECA_PATCH_APP_PATH"] = app.path.path
        process.environment = environment

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        forwardPipe(stdout)
        forwardPipe(stderr)

        let metadata = app.metadata()
        guard process.terminationStatus == 0 else {
            try printJSON(PatchResponse(
                patched: false,
                codexAppPath: app.path.path,
                codexVersion: metadata.codexVersion,
                patchPackVersion: metadata.patchPackVersion,
                extensionApiVersion: metadata.extensionApiVersion,
                error: CommandErrorInfo(
                    phase: "patch",
                    message: "Patcher exited with status \(process.terminationStatus)"
                )
            ))
            throw ExitCode.failure
        }

        try printJSON(PatchResponse(
            patched: app.isPatched(),
            codexAppPath: app.path.path,
            codexVersion: metadata.codexVersion,
            patchPackVersion: metadata.patchPackVersion,
            extensionApiVersion: metadata.extensionApiVersion,
            error: nil
        ))
    }

    private func forwardPipe(_ pipe: Pipe) {
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard !data.isEmpty else {
            return
        }
        FileHandle.standardError.write(data)
    }

    private func resolvePath(_ rawPath: String) -> URL {
        let expanded = NSString(string: rawPath).expandingTildeInPath
        if expanded.hasPrefix("/") {
            return URL(fileURLWithPath: expanded).standardizedFileURL
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(expanded)
            .standardizedFileURL
    }
}

struct CodexAppOptions: ParsableArguments {
    @Option(help: "Exact path to the Codex .app bundle.")
    var codexAppPath: String

    var app: CodexApp {
        get throws {
            try CodexApp(path: codexAppPath)
        }
    }
}

struct IsPatched: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "is-patched",
        abstract: "Checks static patch state for a Codex app bundle."
    )

    @OptionGroup var options: CodexAppOptions

    func run() throws {
        let app = try options.app
        let metadata = app.metadata()
        let response = IsPatchedResponse(
            patched: app.isPatched(),
            codexAppPath: app.path.path,
            codexVersion: metadata.codexVersion,
            patchPackVersion: metadata.patchPackVersion,
            extensionApiVersion: metadata.extensionApiVersion
        )
        try printJSON(response)
    }
}

struct Launch: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "launch",
        abstract: "Launches Codex and optionally waits for patched infrastructure readiness."
    )

    @OptionGroup var options: CodexAppOptions

    @Flag(help: "Wait for patched Codex infrastructure to write a readiness probe.")
    var waitForReady = false

    @Option(help: "Readiness timeout, such as 15s or 500ms.")
    var timeout: DurationValue = DurationValue(seconds: 15)

    @Option(help: .hidden)
    var userDataDir: String?

    func run() throws {
        let app = try options.app
        let metadata = app.metadata()
        guard app.isPatched() else {
            let response = LaunchResponse(
                launched: false,
                ready: false,
                pid: nil,
                codexAppPath: app.path.path,
                codexVersion: metadata.codexVersion,
                patchPackVersion: metadata.patchPackVersion,
                extensionApiVersion: metadata.extensionApiVersion,
                error: CommandErrorInfo(
                    phase: "static-patch-check",
                    message: "Codex app is not patched"
                )
            )
            try printJSON(response)
            throw ExitCode.failure
        }

        let launchStartedAt = Date()
        let process = Process()
        process.executableURL = app.executablePath
        process.currentDirectoryURL = app.contentsPath
        process.environment = launchEnvironment(waitForReady: waitForReady)
        process.arguments = launchArguments()
        let nullOutput = FileHandle(forWritingAtPath: "/dev/null")
        process.standardOutput = nullOutput
        process.standardError = nullOutput

        do {
            try process.run()
        } catch {
            let response = LaunchResponse(
                launched: false,
                ready: false,
                pid: nil,
                codexAppPath: app.path.path,
                codexVersion: metadata.codexVersion,
                patchPackVersion: metadata.patchPackVersion,
                extensionApiVersion: metadata.extensionApiVersion,
                error: CommandErrorInfo(
                    phase: "launch",
                    message: error.localizedDescription
                )
            )
            try printJSON(response)
            throw ExitCode.failure
        }

        guard waitForReady else {
            let response = LaunchResponse(
                launched: true,
                ready: nil,
                pid: process.processIdentifier,
                codexAppPath: app.path.path,
                codexVersion: metadata.codexVersion,
                patchPackVersion: metadata.patchPackVersion,
                extensionApiVersion: metadata.extensionApiVersion,
                error: nil
            )
            try printJSON(response)
            return
        }

        let probeStore = ProbeStore(pid: process.processIdentifier)
        let deadline = Date().addingTimeInterval(timeout.seconds)
        while Date() < deadline {
            if let match = try probeStore.match(
                appPath: app.path.path,
                startedAfter: launchStartedAt
            ) {
                try probeStore.delete()
                let response = LaunchResponse(
                    launched: true,
                    ready: true,
                    pid: process.processIdentifier,
                    codexAppPath: app.path.path,
                    codexVersion: match.codexVersion ?? metadata.codexVersion,
                    patchPackVersion: match.patchPackVersion ?? metadata.patchPackVersion,
                    extensionApiVersion: match.extensionApiVersion ?? metadata.extensionApiVersion,
                    error: nil
                )
                try printJSON(response)
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }

        let response = LaunchResponse(
            launched: true,
            ready: false,
            pid: process.processIdentifier,
            codexAppPath: app.path.path,
            codexVersion: metadata.codexVersion,
            patchPackVersion: metadata.patchPackVersion,
            extensionApiVersion: metadata.extensionApiVersion,
            error: CommandErrorInfo(
                phase: "wait-for-ready",
                message: "Timed out waiting for patched Codex infrastructure readiness probe",
                timeoutSeconds: timeout.seconds
            )
        )
        try printJSON(response)
        throw ExitCode.failure
    }

    private func launchEnvironment(waitForReady: Bool) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        for key in ["BUILD_FLAVOR", "CODEX_CLI_PATH", "CODEX_ELECTRON_RESOURCES_PATH", "NODE_ENV"] {
            environment.removeValue(forKey: key)
        }
        if waitForReady {
            environment["BIBLIOTHECA_WAIT_FOR_READY"] = "1"
        }
        return environment
    }

    private func launchArguments() -> [String] {
        guard let userDataDir, !userDataDir.isEmpty else {
            return []
        }
        return ["--user-data-dir=\(NSString(string: userDataDir).expandingTildeInPath)"]
    }
}

struct CodexApp {
    let path: URL

    init(path rawPath: String) throws {
        let expanded = NSString(string: rawPath).expandingTildeInPath
        let url = URL(fileURLWithPath: expanded).resolvingSymlinksInPath().standardizedFileURL
        guard url.pathExtension == "app" else {
            throw ValidationError("--codex-app-path must point to a .app bundle")
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            throw ValidationError("Codex app does not exist: \(url.path)")
        }
        guard FileManager.default.fileExists(atPath: url.appendingPathComponent("Contents/Info.plist").path) else {
            throw ValidationError("App bundle is missing Contents/Info.plist: \(url.path)")
        }
        self.path = url
    }

    var contentsPath: URL {
        path.appendingPathComponent("Contents")
    }

    var resourcesPath: URL {
        contentsPath.appendingPathComponent("Resources")
    }

    var appResourcesPath: URL {
        resourcesPath.appendingPathComponent("app")
    }

    var executablePath: URL {
        let executableName = plistString("CFBundleExecutable") ?? "Codex"
        return contentsPath.appendingPathComponent("MacOS").appendingPathComponent(executableName)
    }

    func metadata() -> PatchMetadata {
        PatchMetadata(
            codexVersion: plistString("CFBundleShortVersionString"),
            patchPackVersion: readPackageString("bibliothecaPatchPackVersion"),
            extensionApiVersion: readPackageString("bibliothecaExtensionApiVersion")
        )
    }

    func isPatched() -> Bool {
        let webview = appResourcesPath
            .appendingPathComponent("webview")
            .appendingPathComponent("codex-extension-loader.js")
        let mainIpc = appResourcesPath
            .appendingPathComponent(".vite/build/extension-paths.js")
        let unpackedPackage = appResourcesPath.appendingPathComponent("package.json")
        let asarPackage = resourcesPath.appendingPathComponent("app.asar")
        return FileManager.default.fileExists(atPath: webview.path)
            && FileManager.default.fileExists(atPath: mainIpc.path)
            && FileManager.default.fileExists(atPath: unpackedPackage.path)
            && !FileManager.default.fileExists(atPath: asarPackage.path)
    }

    private func plistString(_ key: String) -> String? {
        let plistPath = path.appendingPathComponent("Contents/Info.plist")
        guard let plist = NSDictionary(contentsOf: plistPath) else {
            return nil
        }
        return plist[key] as? String
    }

    private func readPackageString(_ key: String) -> String? {
        let packagePath = appResourcesPath.appendingPathComponent("package.json")
        guard let data = try? Data(contentsOf: packagePath),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        return object[key] as? String
    }
}

struct ProbeStore {
    let path: URL

    init(pid: Int32) {
        let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"]
            .flatMap { $0.isEmpty ? nil : $0 }
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(".codex")
                .path
        path = URL(fileURLWithPath: codexHome)
            .appendingPathComponent("extensions")
            .appendingPathComponent(".\(pid).json")
    }

    func match(appPath: String, startedAfter: Date) throws -> ProbeEntry? {
        guard let entry = try readEntry() else {
            return nil
        }
        return (
            canonicalPath(entry.codexAppPath) == canonicalPath(appPath)
                && entry.date.map { $0 > startedAfter } == true
        ) ? entry : nil
    }

    func delete() throws {
        try? FileManager.default.removeItem(at: path)
    }

    private func readEntry() throws -> ProbeEntry? {
        guard FileManager.default.fileExists(atPath: path.path) else {
            return nil
        }
        let text = try String(contentsOf: path, encoding: .utf8)
        return try JSONDecoder.probe.decode(ProbeEntry.self, from: Data(text.utf8))
    }

    private func canonicalPath(_ rawPath: String) -> String {
        URL(fileURLWithPath: NSString(string: rawPath).expandingTildeInPath)
            .resolvingSymlinksInPath()
            .standardizedFileURL
            .path
    }
}

struct ProbeEntry: Codable, Equatable {
    let timestamp: String
    let codexAppPath: String
    let codexVersion: String?
    let patchPackVersion: String?
    let extensionApiVersion: String?

    var date: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: timestamp)
    }
}

struct PatchMetadata {
    let codexVersion: String?
    let patchPackVersion: String?
    let extensionApiVersion: String?
}

struct IsPatchedResponse: Encodable {
    let patched: Bool
    let codexAppPath: String
    let codexVersion: String?
    let patchPackVersion: String?
    let extensionApiVersion: String?
}

struct LaunchResponse: Encodable {
    let launched: Bool
    let ready: Bool?
    let pid: Int32?
    let codexAppPath: String
    let codexVersion: String?
    let patchPackVersion: String?
    let extensionApiVersion: String?
    let error: CommandErrorInfo?
}

struct PatchResponse: Encodable {
    let patched: Bool
    let codexAppPath: String
    let codexVersion: String?
    let patchPackVersion: String?
    let extensionApiVersion: String?
    let error: CommandErrorInfo?
}

struct CommandErrorInfo: Encodable {
    let phase: String
    let message: String
    var timeoutSeconds: Double? = nil
}

struct DurationValue: ExpressibleByArgument {
    let seconds: Double

    init(seconds: Double) {
        self.seconds = seconds
    }

    init?(argument: String) {
        if let value = Double(argument) {
            seconds = value
            return
        }
        if argument.hasSuffix("ms"),
           let value = Double(argument.dropLast(2))
        {
            seconds = value / 1000
            return
        }
        if argument.hasSuffix("s"),
           let value = Double(argument.dropLast())
        {
            seconds = value
            return
        }
        return nil
    }
}

func printJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

extension JSONDecoder {
    static let probe: JSONDecoder = JSONDecoder()
}
