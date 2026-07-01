import CryptoKit
import Foundation

struct CodexAppBundleInspector: Sendable {
    private let fileSystem: CodexSetupFileSystem

    init(fileSystem: CodexSetupFileSystem) {
        self.fileSystem = fileSystem
    }

    func installedAppURL(selectedAppURL: URL?, candidateAppURLs: [URL]) -> URL? {
        if let selectedAppURL, self.isCodexApp(at: selectedAppURL) {
            return selectedAppURL
        }

        return candidateAppURLs.first { url in
            self.isCodexApp(at: url)
        }
    }

    func identity(at appURL: URL) throws -> CodexAppIdentity {
        let infoURL = appURL.appending(path: "Contents/Info.plist")
        guard self.fileSystem.fileExists(at: infoURL) else {
            throw CodexSetupError.invalidCodexBundle(appURL)
        }

        let data = try self.fileSystem.readData(at: infoURL)
        guard let plist = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
              let shortVersion = plist["CFBundleShortVersionString"] as? String
        else {
            throw CodexSetupError.invalidCodexBundle(appURL)
        }

        let asarURL = appURL.appending(path: "Contents/Resources/app.asar")
        let asarHash = try? self.sha256OfFile(at: asarURL)
        let packageFeedURL = try? self.packageUpdateFeedURL(asarURL: asarURL)

        return CodexAppIdentity(
            bundleIdentifier: plist["CFBundleIdentifier"] as? String,
            version: CodexAppVersion(
                shortVersion: shortVersion,
                bundleVersion: plist["CFBundleVersion"] as? String,
                chromiumVersion: plist["ChromiumBaseVersion"] as? String,
                chromiumBundleVersion: plist["ChromiumBaseBundleVersion"] as? String
            ),
            appASARSHA256: asarHash,
            updateFeedURL: (plist["SUFeedURL"] as? String).flatMap(URL.init(string:)) ?? packageFeedURL
        )
    }

    func isCodexApp(at appURL: URL) -> Bool {
        guard self.fileSystem.directoryExists(at: appURL) else {
            return false
        }

        let infoURL = appURL.appending(path: "Contents/Info.plist")
        guard let data = try? self.fileSystem.readData(at: infoURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any]
        else {
            return false
        }

        return plist["CFBundleIdentifier"] as? String == "com.openai.codex"
    }

    private func sha256OfFile(at url: URL) throws -> String {
        let data = try self.fileSystem.readData(at: url)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func packageUpdateFeedURL(asarURL: URL) throws -> URL? {
        let reader = try CodexAsarReader(data: self.fileSystem.readData(at: asarURL))
        guard let data = try reader.fileData(path: "package.json"),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = object["codexSparkleFeedUrl"] as? String
        else {
            return nil
        }

        return URL(string: value)
    }
}

extension CodexSetupConfiguration {
    static func liveDefault() -> Self {
        let homeURL = URL(filePath: NSHomeDirectory(), directoryHint: .isDirectory)
        let bundledURL = Bundle.module.resourceURL?.appending(path: "BundledExtensions", directoryHint: .isDirectory)
            ?? Bundle.main.resourceURL?.appending(path: "BundledExtensions", directoryHint: .isDirectory)
            ?? homeURL.appending(path: ".codex/extensions-template", directoryHint: .isDirectory)

        return Self(
            candidateAppURLs: [
                URL(filePath: "/Applications/Codex.app", directoryHint: .isDirectory),
                homeURL.appending(path: "Applications/Codex.app", directoryHint: .isDirectory),
            ],
            extensionsRootURL: homeURL.appending(path: ".codex/extensions", directoryHint: .isDirectory),
            provisioningReceiptURL: homeURL.appending(path: ".codex/extensions/.codex-extension-receipt.json"),
            bundledExtensionsRootURL: bundledURL,
            codexUpdateFeedURL: nil
        )
    }
}
