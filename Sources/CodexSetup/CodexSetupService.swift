import Foundation

struct CodexSetupService: Sendable {
    private let configuration: CodexSetupConfiguration
    private let fileSystem: CodexSetupFileSystem
    private let bundleInspector: CodexAppBundleInspector
    private let patchInspector: CodexPatchInspector
    private let appPatcher: CodexAppPatcher
    private let appInstaller: CodexAppInstaller
    private let appProcessController: CodexAppProcessController
    private let extensionStoreInstaller: CodexExtensionStoreInstaller
    private let updateChecker: CodexUpdateChecker

    init(
        configuration: CodexSetupConfiguration = .liveDefault(),
        fileSystem: CodexSetupFileSystem = LocalCodexSetupFileSystem(),
        updateChecker: CodexUpdateChecker = CodexUpdateChecker()
    ) {
        self.configuration = configuration
        self.fileSystem = fileSystem
        self.bundleInspector = CodexAppBundleInspector(fileSystem: fileSystem)
        self.patchInspector = CodexPatchInspector(fileSystem: fileSystem)
        self.appPatcher = CodexAppPatcher(fileSystem: fileSystem)
        self.appInstaller = CodexAppInstaller(fileSystem: fileSystem)
        self.appProcessController = CodexAppProcessController()
        self.extensionStoreInstaller = CodexExtensionStoreInstaller(fileSystem: fileSystem)
        self.updateChecker = updateChecker
    }

    func inspect(selectedAppURL: URL? = nil, checkForUpdates: Bool = false) async -> CodexSetupSnapshot {
        let appURL = self.bundleInspector.installedAppURL(
            selectedAppURL: selectedAppURL,
            candidateAppURLs: self.configuration.candidateAppURLs
        )
        let extensionStatus = self.extensionStoreInstaller.status(at: self.configuration.extensionsRootURL)

        guard let appURL else {
            return CodexSetupSnapshot(
                appURL: nil,
                appIdentity: nil,
                patchState: .missingApp,
                appManagementPermissionGranted: nil,
                isCodexRunning: false,
                extensionStoreStatus: extensionStatus,
                latestCodexUpdate: nil,
                recommendedAction: .openCodexDownloadPage
            )
        }

        do {
            let identity = try self.bundleInspector.identity(at: appURL)
            let patchState = self.patchState(appURL: appURL, identity: identity)
            let appManagementPermissionGranted = self.canManageAppBundle(appURL: appURL)
            let isCodexRunning = self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: identity.bundleIdentifier)
            let latestUpdate = checkForUpdates ? try? await self.updateChecker.latestUpdate(feedURL: self.updateFeedURL(for: identity)) : nil
            let action = self.recommendedAction(
                patchState: patchState,
                appManagementPermissionGranted: appManagementPermissionGranted,
                isCodexRunning: isCodexRunning,
                extensionStatus: extensionStatus,
                latestUpdate: latestUpdate,
                currentVersion: identity.version.shortVersion
            )

            return CodexSetupSnapshot(
                appURL: appURL,
                appIdentity: identity,
                patchState: patchState,
                appManagementPermissionGranted: appManagementPermissionGranted,
                isCodexRunning: isCodexRunning,
                extensionStoreStatus: extensionStatus,
                latestCodexUpdate: latestUpdate,
                recommendedAction: action
            )
        } catch {
            return CodexSetupSnapshot(
                appURL: appURL,
                appIdentity: nil,
                patchState: .unknown(error.localizedDescription),
                appManagementPermissionGranted: nil,
                isCodexRunning: false,
                extensionStoreStatus: extensionStatus,
                latestCodexUpdate: nil,
                recommendedAction: .selectCodexApp
            )
        }
    }

    func installBundledExtensionsDisabled(for appIdentity: CodexAppIdentity) throws {
        try self.extensionStoreInstaller.installDisabledTemplate(
            from: self.configuration.bundledExtensionsRootURL,
            to: self.configuration.extensionsRootURL,
            codexAppVersion: appIdentity.version.shortVersion
        )
    }

    func recordProvisioned(appURL: URL, appIdentity: CodexAppIdentity, date: Date = Date()) throws {
        let receipt = CodexProvisioningReceipt(
            appPath: appURL.path,
            appVersion: appIdentity.version.shortVersion,
            appASARSHA256: appIdentity.appASARSHA256,
            cleanAppASARSHA256: appIdentity.appASARSHA256,
            patchedAppASARSHA256: nil,
            backupDirectoryPath: nil,
            provisionedAt: date
        )
        let data = try JSONEncoder().encode(receipt)
        try self.fileSystem.writeData(data, to: self.configuration.provisioningReceiptURL)
    }

    func patchCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw CodexSetupError.codexStillRunning
        }
        try self.installBundledExtensionsDisabled(for: appIdentity)

        if (try? self.patchInspector.isPatched(appURL: appURL)) == true {
            return
        }

        let result = try self.appPatcher.patch(
            appURL: appURL,
            appVersion: appIdentity.version.shortVersion,
            backupRootURL: self.configuration.extensionsRootURL.appending(path: ".codex-extension-backups", directoryHint: .isDirectory)
        )
        let receipt = CodexProvisioningReceipt(
            appPath: appURL.path,
            appVersion: appIdentity.version.shortVersion,
            appASARSHA256: result.patchedAppASARSHA256,
            cleanAppASARSHA256: result.cleanAppASARSHA256,
            patchedAppASARSHA256: result.patchedAppASARSHA256,
            backupDirectoryPath: result.backupDirectoryURL.path,
            provisionedAt: Date()
        )
        let data = try JSONEncoder().encode(receipt)
        try self.fileSystem.writeData(data, to: self.configuration.provisioningReceiptURL)
    }

    func rollbackCodex(appURL: URL) throws {
        let identity = try? self.bundleInspector.identity(at: appURL)
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: identity?.bundleIdentifier) else {
            throw CodexSetupError.codexStillRunning
        }

        guard let backupDirectoryURL = self.cleanRollbackBackupDirectory(appIdentity: identity) else {
            throw CodexSetupError.rollbackBackupMissing
        }

        try self.appPatcher.rollback(appURL: appURL, backupDirectoryURL: backupDirectoryURL)
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)
    }

    func repairFromLatestCodex(appURL: URL, appIdentity: CodexAppIdentity) async throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw CodexSetupError.codexStillRunning
        }

        guard let update = try await self.latestCodexUpdate(for: appIdentity) else {
            throw CodexSetupError.updateFeedMissing
        }

        try await self.appInstaller.installCleanCodex(from: update, replacing: appURL)
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)
    }

    func restoreCleanCodex(
        from update: CodexUpdateInfo,
        appURL: URL,
        appIdentity: CodexAppIdentity,
        progress: CodexRestoreProgressHandler = { _ in }
    ) async throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw CodexSetupError.codexStillRunning
        }

        guard self.canManageAppBundle(appURL: appURL) else {
            throw CodexSetupError.appManagementPermissionRequired
        }

        try await self.appInstaller.installCleanCodex(from: update, replacing: appURL, progress: progress)
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)
    }

    func uninstallCodexExtension(appURL: URL) throws {
        let identity = try? self.bundleInspector.identity(at: appURL)
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: identity?.bundleIdentifier) else {
            throw CodexSetupError.codexStillRunning
        }

        if (try? self.patchInspector.isPatched(appURL: appURL)) == true {
            try self.rollbackCodex(appURL: appURL)
        }
        try self.fileSystem.removeItem(at: self.configuration.extensionsRootURL)
    }

    func latestCodexUpdate(for appIdentity: CodexAppIdentity) async throws -> CodexUpdateInfo? {
        try await self.updateChecker.latestUpdate(feedURL: self.updateFeedURL(for: appIdentity))
    }

    func availableCodexUpdates(for appIdentity: CodexAppIdentity) async throws -> [CodexUpdateInfo] {
        try await self.updateChecker.availableUpdates(feedURL: self.updateFeedURL(for: appIdentity))
    }

    func quitCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        try self.appProcessController.quit(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier)
    }

    func launchCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            return
        }
        try self.appProcessController.launch(appURL: appURL)
    }

    private func patchState(appURL: URL, identity: CodexAppIdentity) -> CodexPatchState {
        guard let patched = try? self.patchInspector.isPatched(appURL: appURL) else {
            return .damagedPatchedApp
        }

        if patched {
            return .patched
        }

        guard let receipt = self.provisioningReceipt() else {
            return .clean
        }

        if receipt.appPath == appURL.path,
           receipt.appVersion != identity.version.shortVersion,
           receipt.appASARSHA256 != identity.appASARSHA256 {
            return .updatedAfterProvisioning(
                previousVersion: receipt.appVersion,
                currentVersion: identity.version.shortVersion
            )
        }

        return .clean
    }

    private func recommendedAction(
        patchState: CodexPatchState,
        appManagementPermissionGranted: Bool?,
        isCodexRunning: Bool,
        extensionStatus: CodexExtensionStoreStatus,
        latestUpdate: CodexUpdateInfo?,
        currentVersion: String
    ) -> CodexSetupRecommendedAction {
        switch patchState {
        case .missingApp:
            return .openCodexDownloadPage
        case .damagedPatchedApp:
            if appManagementPermissionGranted == false {
                return .openAppManagementSettings
            }
            if isCodexRunning {
                return .quitCodex
            }
            return .repairFromLatestCodex
        case .updatedAfterProvisioning:
            if appManagementPermissionGranted == false {
                return .openAppManagementSettings
            }
            if isCodexRunning {
                return .quitCodex
            }
            return .confirmAutomaticPatchAfterCodexUpdate
        case .patched:
            if !extensionStatus.exists || !extensionStatus.requiredExtensionsEnabled {
                if appManagementPermissionGranted == false {
                    return .openAppManagementSettings
                }
                if isCodexRunning {
                    return .quitCodex
                }
                return .patchCodex
            }
            if let latestUpdate, latestUpdate.version != currentVersion {
                if appManagementPermissionGranted == false {
                    return .openAppManagementSettings
                }
                if isCodexRunning {
                    return .quitCodex
                }
                return .repairFromLatestCodex
            }
            return isCodexRunning ? .ready : .launchCodex
        case .clean:
            if appManagementPermissionGranted == false {
                return .openAppManagementSettings
            }
            if isCodexRunning {
                return .quitCodex
            }
            return .patchCodex
        case .unknown:
            return .selectCodexApp
        }
    }

    private func provisioningReceipt() -> CodexProvisioningReceipt? {
        guard let data = try? self.fileSystem.readData(at: self.configuration.provisioningReceiptURL) else {
            return nil
        }
        return try? JSONDecoder().decode(CodexProvisioningReceipt.self, from: data)
    }

    private func cleanRollbackBackupDirectory(appIdentity: CodexAppIdentity?) -> URL? {
        if let receipt = self.provisioningReceipt(),
           let backupDirectoryPath = receipt.backupDirectoryPath {
            let backupURL = URL(filePath: backupDirectoryPath, directoryHint: .isDirectory)
            if self.isCleanBackup(backupURL) {
                return backupURL
            }
        }

        let backupRootURL = self.configuration.extensionsRootURL.appending(path: ".codex-extension-backups", directoryHint: .isDirectory)
        guard let backups = try? self.fileSystem.contentsOfDirectory(at: backupRootURL) else {
            return nil
        }

        let versionPrefix = appIdentity.map { "\($0.version.shortVersion)-" }
        return backups
            .filter { self.fileSystem.directoryExists(at: $0) }
            .filter { backupURL in
                versionPrefix.map { backupURL.lastPathComponent.hasPrefix($0) } ?? true
            }
            .filter(self.isCleanBackup)
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .first
    }

    private func isCleanBackup(_ backupURL: URL) -> Bool {
        let asarURL = backupURL.appending(path: "app.asar")
        let infoURL = backupURL.appending(path: "Info.plist")
        guard self.fileSystem.fileExists(at: asarURL),
              self.fileSystem.fileExists(at: infoURL),
              let patched = try? self.patchInspector.isPatchedASAR(at: asarURL)
        else {
            return false
        }
        return !patched
    }

    private func updateFeedURL(for appIdentity: CodexAppIdentity) -> URL? {
        self.configuration.codexUpdateFeedURL ?? appIdentity.updateFeedURL
    }

    private func canManageAppBundle(appURL: URL) -> Bool {
        let probeURL = appURL
            .appending(path: "Contents/Resources", directoryHint: .isDirectory)
            .appending(path: ".codex-extension-permission-check-\(UUID().uuidString)")
        do {
            try self.fileSystem.writeData(Data("ok".utf8), to: probeURL)
            try self.fileSystem.removeItem(at: probeURL)
            return true
        } catch {
            try? self.fileSystem.removeItem(at: probeURL)
            return false
        }
    }
}
