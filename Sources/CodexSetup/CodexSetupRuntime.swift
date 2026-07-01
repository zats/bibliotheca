import Foundation

public struct CodexSetupRuntime: Sendable {
    private let service: CodexSetupService

    public init() {
        self.service = CodexSetupService()
    }

    public func inspect(appURL: URL? = nil, checkForUpdates: Bool = false) async -> CodexSetupSnapshot {
        await self.service.inspect(selectedAppURL: appURL, checkForUpdates: checkForUpdates)
    }

    public func installBundledExtensionsDisabled(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.installBundledExtensionsDisabled(for: snapshot.appIdentity)
    }

    public func patchCodex(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.patchCodex(appURL: snapshot.appURL, appIdentity: snapshot.appIdentity)
    }

    public func rollbackCodex(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.rollbackCodex(appURL: snapshot.appURL)
    }

    public func quitCodex(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.quitCodex(appURL: snapshot.appURL, appIdentity: snapshot.appIdentity)
    }

    public func launchCodex(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.launchCodex(appURL: snapshot.appURL, appIdentity: snapshot.appIdentity)
    }

    public func repairFromLatestCodex(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL, checkForUpdates: true)
        try await self.service.repairFromLatestCodex(appURL: snapshot.appURL, appIdentity: snapshot.appIdentity)
    }

    public func availableRestoreOptions(appURL: URL? = nil) async throws -> [CodexRestoreOption] {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        let updates = try await self.service.availableCodexUpdates(for: snapshot.appIdentity)
        return updates.enumerated().map { index, update in
            CodexRestoreOption(version: update.version, downloadURL: update.downloadURL, isLatest: index == 0)
        }
    }

    public func restoreCleanCodex(
        _ option: CodexRestoreOption,
        appURL: URL? = nil,
        progress: CodexRestoreProgressHandler = { _ in }
    ) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        let update = CodexUpdateInfo(version: option.version, downloadURL: option.downloadURL)
        try await self.service.restoreCleanCodex(
            from: update,
            appURL: snapshot.appURL,
            appIdentity: snapshot.appIdentity,
            progress: progress
        )
    }

    public func uninstallCodexExtension(appURL: URL? = nil) async throws {
        let snapshot = try await self.requiredSnapshot(appURL: appURL)
        try self.service.uninstallCodexExtension(appURL: snapshot.appURL)
    }

    public func performRecommendedAction(appURL: URL? = nil) async throws -> CodexSetupRecommendedAction {
        let values = try await self.requiredSnapshot(appURL: appURL, checkForUpdates: true)
        switch values.snapshot.recommendedAction {
        case .openCodexDownloadPage, .selectCodexApp, .openAppManagementSettings, .ready:
            return values.snapshot.recommendedAction
        case .quitCodex:
            try self.service.quitCodex(appURL: values.appURL, appIdentity: values.appIdentity)
        case .launchCodex:
            try self.service.launchCodex(appURL: values.appURL, appIdentity: values.appIdentity)
        case .installExtensionStore:
            try self.service.installBundledExtensionsDisabled(for: values.appIdentity)
        case .patchCodex, .confirmAutomaticPatchAfterCodexUpdate:
            try self.service.patchCodex(appURL: values.appURL, appIdentity: values.appIdentity)
        case .rollbackToCleanCodex:
            try self.service.rollbackCodex(appURL: values.appURL)
        case .repairFromLatestCodex:
            try await self.service.repairFromLatestCodex(appURL: values.appURL, appIdentity: values.appIdentity)
        case .uninstallCodexExtension:
            try self.service.uninstallCodexExtension(appURL: values.appURL)
        }
        return values.snapshot.recommendedAction
    }

    private func requiredSnapshot(appURL: URL?, checkForUpdates: Bool = false) async throws -> (snapshot: CodexSetupSnapshot, appURL: URL, appIdentity: CodexAppIdentity) {
        let snapshot = await self.inspect(appURL: appURL, checkForUpdates: checkForUpdates)
        guard let appURL = snapshot.appURL, let appIdentity = snapshot.appIdentity else {
            throw CodexSetupError.codexAppMissing
        }
        return (snapshot, appURL, appIdentity)
    }
}
