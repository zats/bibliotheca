import Foundation
import xxHash

struct CodexASARIdentity: Sendable {
    var hash: String
    var updateFeedURL: URL?
}

final class CodexASARIdentityCache: @unchecked Sendable {
    private struct Entry {
        var fingerprint: CodexFileFingerprint
        var identity: CodexASARIdentity
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]

    func identity(at asarURL: URL, fileSystem: CodexSetupFileSystem) throws -> CodexASARIdentity {
        let fingerprint = try fileSystem.fingerprint(at: asarURL)
        let key = asarURL.path

        self.lock.lock()
        if let entry = self.entries[key], entry.fingerprint == fingerprint {
            self.lock.unlock()
            return entry.identity
        }
        self.lock.unlock()

        let data = try fileSystem.readData(at: asarURL)
        let identity = CodexASARIdentity(
            hash: try Self.xxh3Hex(data),
            updateFeedURL: try Self.packageUpdateFeedURL(data: data)
        )

        self.lock.lock()
        self.entries[key] = Entry(fingerprint: fingerprint, identity: identity)
        self.lock.unlock()

        return identity
    }

    func invalidate(at asarURL: URL) {
        self.lock.lock()
        self.entries.removeValue(forKey: asarURL.path)
        self.lock.unlock()
    }

    private static func xxh3Hex(_ data: Data) throws -> String {
        let hash = data.withUnsafeBytes { buffer in
            xxHash128.hash(buffer, seed: nil, secretBuf: nil)
        }
        return Self.hex(UInt64(hash.high)) + Self.hex(UInt64(hash.low))
    }

    private static func hex(_ value: UInt64) -> String {
        String(format: "%016llx", value)
    }

    private static func packageUpdateFeedURL(data: Data) throws -> URL? {
        let reader = try CodexAsarReader(data: data)
        guard let data = try reader.fileData(path: "package.json"),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["codexSparkleFeedUrl"] as? String
        else {
            return nil
        }

        return URL(string: value)
    }
}
