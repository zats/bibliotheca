import Foundation

struct CodexUpdateChecker: Sendable {
    private let urlSession: URLSession
    private let timeout: TimeInterval

    init(urlSession: URLSession = .shared, timeout: TimeInterval = 10) {
        self.urlSession = urlSession
        self.timeout = timeout
    }

    func latestUpdate(feedURL: URL?) async throws -> CodexUpdateInfo? {
        try await self.availableUpdates(feedURL: feedURL).first
    }

    func availableUpdates(feedURL: URL?) async throws -> [CodexUpdateInfo] {
        guard let feedURL else {
            throw CodexSetupError.updateFeedMissing
        }

        let request = URLRequest(url: feedURL, timeoutInterval: self.timeout)
        let (data, _) = try await self.urlSession.data(for: request)
        let parser = SparkleAppcastParser()
        return try parser.availableUpdates(from: data)
    }
}

final class SparkleAppcastParser: NSObject, XMLParserDelegate {
    private var currentElement = ""
    private var currentText = ""
    private var itemTitle: String?
    private var itemVersion: String?
    private var itemDownloadURL: URL?
    private var isInItem = false
    private var updates: [CodexUpdateInfo] = []

    func latestUpdate(from data: Data) throws -> CodexUpdateInfo? {
        try self.availableUpdates(from: data).first
    }

    func availableUpdates(from data: Data) throws -> [CodexUpdateInfo] {
        self.currentElement = ""
        self.currentText = ""
        self.itemTitle = nil
        self.itemVersion = nil
        self.itemDownloadURL = nil
        self.isInItem = false
        self.updates = []

        let parser = XMLParser(data: data)
        parser.delegate = self
        guard parser.parse() else {
            throw CodexSetupError.updateFeedMalformed
        }

        var seenVersions = Set<String>()
        return self.updates.filter { update in
            guard !seenVersions.contains(update.version) else {
                return false
            }
            seenVersions.insert(update.version)
            return true
        }
    }

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        self.currentElement = elementName
        self.currentText = ""
        if elementName == "item" {
            self.isInItem = true
            self.itemTitle = nil
            self.itemVersion = nil
            self.itemDownloadURL = nil
        }

        if elementName == "enclosure" {
            self.itemVersion = self.attribute("shortVersionString", in: attributeDict) ?? self.attribute("version", in: attributeDict)
            self.itemDownloadURL = self.attribute("url", in: attributeDict).flatMap(URL.init(string:))
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if self.isInItem {
            self.currentText += string
        }
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        if self.isInItem, elementName == "title" {
            let title = self.currentText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty {
                self.itemTitle = title
            }
        }

        if elementName == "item" {
            if let version = self.itemVersion ?? self.itemTitle, !version.isEmpty {
                self.updates.append(CodexUpdateInfo(version: version, downloadURL: self.itemDownloadURL))
            }
            self.isInItem = false
        }

        self.currentElement = ""
        self.currentText = ""
    }

    private func attribute(_ name: String, in attributes: [String: String]) -> String? {
        attributes[name]
            ?? attributes["sparkle:\(name)"]
            ?? attributes.first { key, _ in key.hasSuffix("}\(name)") }?.value
    }
}
