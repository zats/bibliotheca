import Foundation

struct CodexExtensionStoreInstaller: Sendable {
    private static let requiredInfrastructureExtensionIDs: Set<String> = ["extensions-manager"]

    private let fileSystem: CodexSetupFileSystem

    init(fileSystem: CodexSetupFileSystem) {
        self.fileSystem = fileSystem
    }

    func status(at rootURL: URL) -> CodexExtensionStoreStatus {
        guard self.fileSystem.directoryExists(at: rootURL) else {
            return CodexExtensionStoreStatus(
                exists: false,
                bootloaderVersion: nil,
                extensionIDs: [],
                disabledExtensionIDs: [],
                requiredExtensionIDs: [],
                disabledRequiredExtensionIDs: []
            )
        }

        let state = self.disabledExtensionIDs(at: rootURL.appending(path: "state.json"))
        let manifests = (try? self.fileSystem.contentsOfDirectory(at: rootURL)) ?? []
        let extensions = manifests.compactMap { directoryURL -> ExtensionManifestSummary? in
            let manifestURL = directoryURL.appending(path: "manifest.json")
            guard self.fileSystem.fileExists(at: manifestURL) else {
                return nil
            }
            return try? self.readManifestSummary(at: manifestURL)
        }

        let bootloaderVersion = extensions.first { $0.id == "bootloader" }?.codexAppVersion
        let requiredExtensionIDs = Set(extensions.map(\.id)).intersection(Self.requiredInfrastructureExtensionIDs)
        let userExtensionIDs = extensions
            .filter { !$0.internalExtension && !Self.requiredInfrastructureExtensionIDs.contains($0.id) }
            .map(\.id)
            .sorted()

        return CodexExtensionStoreStatus(
            exists: true,
            bootloaderVersion: bootloaderVersion,
            extensionIDs: userExtensionIDs,
            disabledExtensionIDs: state.intersection(Set(userExtensionIDs)),
            requiredExtensionIDs: requiredExtensionIDs,
            disabledRequiredExtensionIDs: state.intersection(Self.requiredInfrastructureExtensionIDs)
        )
    }

    func installDisabledTemplate(from templateRootURL: URL, to destinationRootURL: URL, codexAppVersion: String) throws {
        guard self.fileSystem.directoryExists(at: templateRootURL) else {
            throw CodexSetupError.bundledExtensionsMissing(templateRootURL)
        }

        try self.fileSystem.createDirectory(at: destinationRootURL)
        let templateDirectories = try self.fileSystem.contentsOfDirectory(at: templateRootURL)
        let existingState = self.extensionEnabledState(at: destinationRootURL.appending(path: "state.json"))
        var enabledState = [String: Bool]()

        for templateDirectory in templateDirectories {
            let manifestURL = templateDirectory.appending(path: "manifest.json")
            guard self.fileSystem.fileExists(at: manifestURL) else {
                continue
            }

            let manifest = try self.updatedManifestData(at: manifestURL, codexAppVersion: codexAppVersion)
            let extensionID = try self.readManifestSummary(from: manifest, manifestURL: manifestURL)
            let destinationDirectory = destinationRootURL.appending(path: templateDirectory.lastPathComponent, directoryHint: .isDirectory)

            try self.fileSystem.createDirectory(at: destinationDirectory)
            try self.fileSystem.writeData(manifest, to: destinationDirectory.appending(path: "manifest.json"))

            let sourceDirectory = templateDirectory.appending(path: "src", directoryHint: .isDirectory)
            if self.fileSystem.directoryExists(at: sourceDirectory) {
                try self.copyDirectoryTree(
                    from: sourceDirectory,
                    to: destinationDirectory.appending(path: "src", directoryHint: .isDirectory)
                )
            }

            if Self.requiredInfrastructureExtensionIDs.contains(extensionID.id) {
                enabledState[extensionID.id] = true
            } else if !extensionID.internalExtension {
                enabledState[extensionID.id] = existingState[extensionID.id] ?? false
            }
        }

        let stateData = try JSONSerialization.data(withJSONObject: enabledState, options: [.prettyPrinted, .sortedKeys])
        try self.fileSystem.writeData(stateData, to: destinationRootURL.appending(path: "state.json"))
    }

    private func disabledExtensionIDs(at stateURL: URL) -> Set<String> {
        let state = self.extensionEnabledState(at: stateURL)
        return Set(state.compactMap { id, enabled in enabled ? nil : id })
    }

    private func extensionEnabledState(at stateURL: URL) -> [String: Bool] {
        guard let data = try? self.fileSystem.readData(at: stateURL),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Bool]
        else {
            return [:]
        }
        return state
    }

    private func copyDirectoryTree(from sourceURL: URL, to destinationURL: URL) throws {
        try self.fileSystem.createDirectory(at: destinationURL)

        for sourceChildURL in try self.fileSystem.contentsOfDirectory(at: sourceURL) {
            let destinationChildURL = destinationURL.appending(path: sourceChildURL.lastPathComponent)
            if self.fileSystem.directoryExists(at: sourceChildURL) {
                try self.copyDirectoryTree(from: sourceChildURL, to: destinationChildURL)
            } else {
                let data = try self.fileSystem.readData(at: sourceChildURL)
                try self.fileSystem.writeData(data, to: destinationChildURL)
            }
        }
    }

    private func updatedManifestData(at manifestURL: URL, codexAppVersion: String) throws -> Data {
        let data = try self.fileSystem.readData(at: manifestURL)
        guard var manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CodexSetupError.invalidExtensionManifest(manifestURL)
        }

        manifest["codexAppVersion"] = codexAppVersion
        return try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    }

    private func readManifestSummary(at manifestURL: URL) throws -> ExtensionManifestSummary {
        let data = try self.fileSystem.readData(at: manifestURL)
        return try self.readManifestSummary(from: data, manifestURL: manifestURL)
    }

    private func readManifestSummary(from data: Data, manifestURL: URL) throws -> ExtensionManifestSummary {
        guard let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = manifest["id"] as? String
        else {
            throw CodexSetupError.invalidExtensionManifest(manifestURL)
        }

        return ExtensionManifestSummary(
            id: id,
            codexAppVersion: manifest["codexAppVersion"] as? String,
            internalExtension: manifest["internal"] as? Bool ?? false
        )
    }
}

private struct ExtensionManifestSummary {
    var id: String
    var codexAppVersion: String?
    var internalExtension: Bool
}
