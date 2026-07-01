import Foundation

struct CodexAsarReader {
    private let data: Data
    private let files: [String: Any]
    private let contentStart: Int

    init(data: Data) throws {
        guard data.count >= 16 else {
            throw CodexSetupError.invalidCodexBundle(URL(filePath: "app.asar"))
        }

        let headerSize = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self).littleEndian })
        guard data.count >= 8 + headerSize, headerSize >= 8 else {
            throw CodexSetupError.invalidCodexBundle(URL(filePath: "app.asar"))
        }

        let header = data.subdata(in: 8..<(8 + headerSize))
        let stringSize = Int(header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self).littleEndian })
        guard header.count >= 8 + stringSize else {
            throw CodexSetupError.invalidCodexBundle(URL(filePath: "app.asar"))
        }

        let headerData = header.subdata(in: 8..<(8 + stringSize))
        guard let object = try JSONSerialization.jsonObject(with: headerData) as? [String: Any],
              let files = object["files"] as? [String: Any]
        else {
            throw CodexSetupError.invalidCodexBundle(URL(filePath: "app.asar"))
        }

        self.data = data
        self.files = files
        self.contentStart = 8 + headerSize
    }

    func fileData(path: String) throws -> Data? {
        let parts = path.split(separator: "/").map(String.init)
        guard let entry = self.entry(parts: parts) else {
            return nil
        }

        guard let size = entry["size"] as? Int,
              let offsetValue = entry["offset"],
              let offset = Self.offset(from: offsetValue),
              entry["unpacked"] == nil
        else {
            return nil
        }

        let start = self.contentStart + offset
        let end = start + size
        guard start >= 0, end <= self.data.count else {
            throw CodexSetupError.invalidCodexBundle(URL(filePath: "app.asar"))
        }

        return self.data.subdata(in: start..<end)
    }

    private func entry(parts: [String]) -> [String: Any]? {
        var directory = self.files
        for (index, part) in parts.enumerated() {
            guard let node = directory[part] as? [String: Any] else {
                return nil
            }

            if index == parts.indices.last {
                return node
            }

            guard let next = node["files"] as? [String: Any] else {
                return nil
            }
            directory = next
        }
        return nil
    }

    private static func offset(from value: Any) -> Int? {
        if let string = value as? String {
            return Int(string)
        }
        if let number = value as? NSNumber {
            return number.intValue
        }
        return nil
    }
}
