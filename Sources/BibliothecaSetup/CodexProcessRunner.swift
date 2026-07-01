import Foundation

struct CodexProcessResult: Sendable {
    var status: Int32
    var output: String
}

struct CodexProcessRunner: Sendable {
    func run(_ executable: String, arguments: [String]) throws -> CodexProcessResult {
        try self.run(executable, arguments: arguments, environment: nil)
    }

    func run(_ executable: String, arguments: [String], environment: [String: String]?) throws -> CodexProcessResult {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(filePath: executable)
        process.arguments = arguments
        if let environment {
            process.environment = environment
        }
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let output = String(data: data, encoding: .utf8) ?? ""
        let result = CodexProcessResult(status: process.terminationStatus, output: output)
        if result.status != 0 {
            throw BibliothecaSetupError.processFailed(executable: executable, status: result.status, output: output)
        }
        return result
    }
}
