import Foundation

struct CodexFileFingerprint: Hashable, Sendable {
    var path: String
    var fileSize: UInt64
    var modificationDate: Date?
    var systemFileNumber: UInt64?
}

protocol BibliothecaSetupFileSystem: Sendable {
    func fileExists(at url: URL) -> Bool
    func directoryExists(at url: URL) -> Bool
    func fingerprint(at url: URL) throws -> CodexFileFingerprint
    func readData(at url: URL) throws -> Data
    func writeData(_ data: Data, to url: URL) throws
    func createDirectory(at url: URL) throws
    func removeItem(at url: URL) throws
    func moveItem(at sourceURL: URL, to destinationURL: URL) throws
    func copyItem(at sourceURL: URL, to destinationURL: URL) throws
    func replaceItem(at originalItemURL: URL, withItemAt newItemURL: URL, backupItemName: String?) throws
    func contentsOfDirectory(at url: URL) throws -> [URL]
}

final class LocalBibliothecaSetupFileSystem: BibliothecaSetupFileSystem, @unchecked Sendable {
    private let fileManager: FileManager

    init(fileManager: FileManager = FileManager()) {
        self.fileManager = fileManager
    }

    func fileExists(at url: URL) -> Bool {
        var isDirectory = ObjCBool(false)
        return self.fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && !isDirectory.boolValue
    }

    func directoryExists(at url: URL) -> Bool {
        var isDirectory = ObjCBool(false)
        return self.fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    func fingerprint(at url: URL) throws -> CodexFileFingerprint {
        let attributes = try self.fileManager.attributesOfItem(atPath: url.path)
        let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
        let fileNumber = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value
        return CodexFileFingerprint(
            path: url.path,
            fileSize: size,
            modificationDate: attributes[.modificationDate] as? Date,
            systemFileNumber: fileNumber
        )
    }

    func readData(at url: URL) throws -> Data {
        try Data(contentsOf: url)
    }

    func writeData(_ data: Data, to url: URL) throws {
        try self.createDirectory(at: url.deletingLastPathComponent())
        try data.write(to: url, options: [.atomic])
    }

    func createDirectory(at url: URL) throws {
        try self.fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func removeItem(at url: URL) throws {
        if self.fileManager.fileExists(atPath: url.path) {
            try self.fileManager.removeItem(at: url)
        }
    }

    func moveItem(at sourceURL: URL, to destinationURL: URL) throws {
        try self.createDirectory(at: destinationURL.deletingLastPathComponent())
        try self.removeItem(at: destinationURL)
        try self.fileManager.moveItem(at: sourceURL, to: destinationURL)
    }

    func copyItem(at sourceURL: URL, to destinationURL: URL) throws {
        try self.createDirectory(at: destinationURL.deletingLastPathComponent())
        try self.removeItem(at: destinationURL)
        try self.fileManager.copyItem(at: sourceURL, to: destinationURL)
    }

    func replaceItem(at originalItemURL: URL, withItemAt newItemURL: URL, backupItemName: String?) throws {
        _ = try self.fileManager.replaceItemAt(originalItemURL, withItemAt: newItemURL, backupItemName: backupItemName)
    }

    func contentsOfDirectory(at url: URL) throws -> [URL] {
        try self.fileManager.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: []
        )
    }
}
