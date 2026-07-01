import Foundation

struct BibliothecaSetupService: Sendable {
    private let configuration: BibliothecaSetupConfiguration
    private let fileSystem: BibliothecaSetupFileSystem
    private let asarIdentityCache: CodexASARIdentityCache
    private let bundleInspector: CodexAppBundleInspector
    private let patchInspector: CodexPatchInspector
    private let appPatcher: CodexAppPatcher
    private let appInstaller: CodexAppInstaller
    private let appProcessController: CodexAppProcessController
    private let extensionStoreInstaller: BibliothecaStoreInstaller
    private let skillInstaller: CodexSkillInstaller
    private let updateChecker: CodexUpdateChecker
    private let backupStore: CodexPatchBackupStore

    init(
        configuration: BibliothecaSetupConfiguration = .liveDefault(),
        fileSystem: BibliothecaSetupFileSystem = LocalBibliothecaSetupFileSystem(),
        updateChecker: CodexUpdateChecker = CodexUpdateChecker()
    ) {
        self.configuration = configuration
        self.fileSystem = fileSystem
        let asarIdentityCache = CodexASARIdentityCache()
        self.asarIdentityCache = asarIdentityCache
        self.bundleInspector = CodexAppBundleInspector(fileSystem: fileSystem, asarIdentityCache: asarIdentityCache)
        let patchInspector = CodexPatchInspector(fileSystem: fileSystem)
        self.patchInspector = patchInspector
        self.appPatcher = CodexAppPatcher(fileSystem: fileSystem, asarIdentityCache: asarIdentityCache)
        self.appInstaller = CodexAppInstaller(fileSystem: fileSystem)
        self.appProcessController = CodexAppProcessController()
        self.extensionStoreInstaller = BibliothecaStoreInstaller(fileSystem: fileSystem)
        self.skillInstaller = CodexSkillInstaller(fileSystem: fileSystem)
        self.updateChecker = updateChecker
        self.backupStore = CodexPatchBackupStore(
            rootURL: configuration.extensionsRootURL.appending(path: ".bibliotheca-backups", directoryHint: .isDirectory),
            fileSystem: fileSystem,
            patchInspector: patchInspector
        )
    }

    func inspect(selectedAppURL: URL? = nil, checkForUpdates: Bool = false) async -> BibliothecaSetupSnapshot {
        let appURL = self.bundleInspector.installedAppURL(
            selectedAppURL: selectedAppURL,
            candidateAppURLs: self.configuration.candidateAppURLs
        )
        let extensionStatus = self.extensionStoreInstaller.status(at: self.configuration.extensionsRootURL)

        guard let appURL else {
            return BibliothecaSetupSnapshot(
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

            return BibliothecaSetupSnapshot(
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
            return BibliothecaSetupSnapshot(
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
        try self.skillInstaller.installBundledSkills(
            from: self.configuration.bundledSkillsRootURL,
            to: self.configuration.skillsRootURL
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
        try self.writeProvisioningReceipt(receipt)
    }

    func patchCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw BibliothecaSetupError.codexStillRunning
        }
        try self.installBundledExtensionsDisabled(for: appIdentity)

        if (try? self.patchInspector.isPatched(appURL: appURL)) == true {
            if let backupDirectoryURL = self.currentRollbackBackupDirectory(appURL: appURL, appIdentity: appIdentity) {
                try self.backupStore.pruneRetaining(backupDirectoryURL)
            }
            return
        }

        let result = try self.appPatcher.patch(
            appURL: appURL,
            appVersion: appIdentity.version.shortVersion,
            backupRootURL: self.backupStore.rootURL
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
        try self.writeProvisioningReceipt(receipt)
        try self.backupStore.pruneRetaining(result.backupDirectoryURL)
    }

    func rollbackCodex(appURL: URL) throws {
        let identity = try? self.bundleInspector.identity(at: appURL)
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: identity?.bundleIdentifier) else {
            throw BibliothecaSetupError.codexStillRunning
        }

        guard let identity,
              let backupDirectoryURL = self.currentRollbackBackupDirectory(appURL: appURL, appIdentity: identity)
        else {
            throw BibliothecaSetupError.rollbackBackupMissing
        }

        try self.withProvisioningReceiptSuppressed {
            try self.appPatcher.rollback(appURL: appURL, backupDirectoryURL: backupDirectoryURL)
            try self.validateCleanCodex(appURL: appURL)
        }
        try self.removeProvisioningState()
    }

    func repairFromLatestCodex(appURL: URL, appIdentity: CodexAppIdentity) async throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw BibliothecaSetupError.codexStillRunning
        }

        guard let update = try await self.latestCodexUpdate(for: appIdentity) else {
            throw BibliothecaSetupError.updateFeedMissing
        }

        try await self.withProvisioningReceiptSuppressed {
            try await self.appInstaller.installCleanCodex(from: update, replacing: appURL)
            try self.validateCleanCodex(appURL: appURL)
        }
        try self.removeProvisioningState()
    }

    func restoreCleanCodex(
        from update: CodexUpdateInfo,
        appURL: URL,
        appIdentity: CodexAppIdentity,
        progress: CodexRestoreProgressHandler = { _ in }
    ) async throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            throw BibliothecaSetupError.codexStillRunning
        }

        guard self.canManageAppBundle(appURL: appURL) else {
            throw BibliothecaSetupError.appManagementPermissionRequired
        }

        let sameVersionBackupURL = self.currentRollbackBackupDirectory(appURL: appURL, appIdentity: appIdentity)
        try await self.withProvisioningReceiptSuppressed {
            if update.downloadURL == nil,
               update.version == appIdentity.version.shortVersion,
               let backupDirectoryURL = sameVersionBackupURL {
                await progress(CodexRestoreProgress(phase: .preparing, fraction: 0.05, detail: "Restoring saved clean Codex"))
                try self.appPatcher.rollback(appURL: appURL, backupDirectoryURL: backupDirectoryURL)
                await progress(CodexRestoreProgress(phase: .cleaningUp, fraction: 0.98, detail: "Cleaning up"))
                await progress(CodexRestoreProgress(phase: .complete, fraction: 1, detail: "Restore complete"))
            } else {
                try await self.appInstaller.installCleanCodex(from: update, replacing: appURL, progress: progress)
            }
            try self.validateCleanCodex(appURL: appURL)
        }
        try self.removeProvisioningState()
    }

    func uninstallBibliotheca(appURL: URL) throws {
        let identity = try? self.bundleInspector.identity(at: appURL)
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: identity?.bundleIdentifier) else {
            throw BibliothecaSetupError.codexStillRunning
        }

        if (try? self.patchInspector.isPatched(appURL: appURL)) == true {
            try self.rollbackCodex(appURL: appURL)
        }
        try self.removeProvisioningState()
        try self.fileSystem.removeItem(at: self.configuration.extensionsRootURL)
    }

    func latestCodexUpdate(for appIdentity: CodexAppIdentity) async throws -> CodexUpdateInfo? {
        try await self.updateChecker.latestUpdate(feedURL: self.updateFeedURL(for: appIdentity))
    }

    func availableCodexUpdates(for appIdentity: CodexAppIdentity) async throws -> [CodexUpdateInfo] {
        try await self.updateChecker.availableUpdates(feedURL: self.updateFeedURL(for: appIdentity))
    }

    func availableRestoreOptions(appURL: URL, appIdentity: CodexAppIdentity) async throws -> [CodexRestoreOption] {
        let localBackupURL = self.currentRollbackBackupDirectory(appURL: appURL, appIdentity: appIdentity)
        let updates: [CodexUpdateInfo]
        do {
            updates = try await self.availableCodexUpdates(for: appIdentity)
        } catch {
            guard localBackupURL != nil else {
                throw error
            }
            updates = []
        }

        var options = updates.enumerated().map { index, update in
            CodexRestoreOption(version: update.version, downloadURL: update.downloadURL, isLatest: index == 0)
        }

        if localBackupURL != nil,
           !options.contains(where: { $0.version == appIdentity.version.shortVersion }) {
            options.insert(CodexRestoreOption(version: appIdentity.version.shortVersion, downloadURL: nil, isLatest: options.isEmpty), at: 0)
        }

        return options
    }

    func quitCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        try self.appProcessController.quit(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier)
    }

    func prunePatchBackups(appURL: URL, appIdentity: CodexAppIdentity) throws {
        if let backupDirectoryURL = self.currentRollbackBackupDirectory(appURL: appURL, appIdentity: appIdentity) {
            try self.backupStore.pruneRetaining(backupDirectoryURL)
        } else if (try? self.patchInspector.isPatched(appURL: appURL)) == false {
            try self.backupStore.pruneAll()
        }
    }

    func launchCodex(appURL: URL, appIdentity: CodexAppIdentity) throws {
        guard !self.appProcessController.isRunning(appURL: appURL, bundleIdentifier: appIdentity.bundleIdentifier) else {
            return
        }
        try self.appProcessController.launch(appURL: appURL)
    }

    func repatchUpdatedCodexIfNeeded(selectedAppURL: URL? = nil, launchAfterPatch: Bool = true) async throws -> CodexUpdateRepatchOutcome {
        let snapshot = await self.inspect(selectedAppURL: selectedAppURL)
        switch CodexUpdateRepatchPolicy.plan(for: snapshot) {
        case .none:
            return .skipped
        case .needsAppManagementPermission:
            return .needsAppManagementPermission
        case .quitPatchAndLaunch:
            guard let appURL = snapshot.appURL, let appIdentity = snapshot.appIdentity else {
                return .skipped
            }
            try self.quitCodex(appURL: appURL, appIdentity: appIdentity)
            return try await self.patchUpdatedCodexAfterReinspection(selectedAppURL: selectedAppURL, launchAfterPatch: launchAfterPatch)
        case .patchAndLaunch:
            return try await self.patchUpdatedCodexAfterReinspection(selectedAppURL: selectedAppURL, launchAfterPatch: launchAfterPatch)
        }
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

    private func patchUpdatedCodexAfterReinspection(selectedAppURL: URL?, launchAfterPatch: Bool) async throws -> CodexUpdateRepatchOutcome {
        let snapshot = await self.inspect(selectedAppURL: selectedAppURL)
        guard case .updatedAfterProvisioning = snapshot.patchState,
              snapshot.appManagementPermissionGranted == true,
              snapshot.isCodexRunning == false,
              let appURL = snapshot.appURL,
              let appIdentity = snapshot.appIdentity
        else {
            return CodexUpdateRepatchPolicy.plan(for: snapshot) == .needsAppManagementPermission ? .needsAppManagementPermission : .skipped
        }

        try self.patchCodex(appURL: appURL, appIdentity: appIdentity)
        let patchedSnapshot = await self.inspect(selectedAppURL: selectedAppURL)
        guard patchedSnapshot.patchState == .patched,
              let patchedAppURL = patchedSnapshot.appURL,
              let patchedAppIdentity = patchedSnapshot.appIdentity
        else {
            return .skipped
        }
        guard launchAfterPatch else {
            return .repatched
        }
        try self.launchCodex(appURL: patchedAppURL, appIdentity: patchedAppIdentity)
        return .repatchedAndLaunched
    }

    private func recommendedAction(
        patchState: CodexPatchState,
        appManagementPermissionGranted: Bool?,
        isCodexRunning: Bool,
        extensionStatus: BibliothecaStoreStatus,
        latestUpdate: CodexUpdateInfo?,
        currentVersion: String
    ) -> BibliothecaSetupRecommendedAction {
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

    private func writeProvisioningReceipt(_ receipt: CodexProvisioningReceipt) throws {
        let data = try JSONEncoder().encode(receipt)
        try self.fileSystem.writeData(data, to: self.configuration.provisioningReceiptURL)
        guard self.provisioningReceipt() == receipt else {
            throw BibliothecaSetupError.provisioningReceiptInvalid
        }
    }

    func removeProvisioningState() throws {
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)
        try self.backupStore.pruneAll()
    }

    private func withProvisioningReceiptSuppressed(_ work: () throws -> Void) throws {
        let receiptData = try? self.fileSystem.readData(at: self.configuration.provisioningReceiptURL)
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)

        do {
            try work()
        } catch {
            if let receiptData {
                try? self.fileSystem.writeData(receiptData, to: self.configuration.provisioningReceiptURL)
            }
            throw error
        }
    }

    private func withProvisioningReceiptSuppressed(_ work: () async throws -> Void) async throws {
        let receiptData = try? self.fileSystem.readData(at: self.configuration.provisioningReceiptURL)
        try self.fileSystem.removeItem(at: self.configuration.provisioningReceiptURL)

        do {
            try await work()
        } catch {
            if let receiptData {
                try? self.fileSystem.writeData(receiptData, to: self.configuration.provisioningReceiptURL)
            }
            throw error
        }
    }

    private func validateCleanCodex(appURL: URL) throws {
        if (try? self.patchInspector.isPatched(appURL: appURL)) != false {
            throw BibliothecaSetupError.cleanRestoreStillPatched
        }
    }

    private func currentRollbackBackupDirectory(appURL: URL, appIdentity: CodexAppIdentity) -> URL? {
        guard let receipt = self.provisioningReceipt() else {
            return nil
        }
        return self.backupStore.backupURL(from: receipt, appURL: appURL, appIdentity: appIdentity)
    }

    private func updateFeedURL(for appIdentity: CodexAppIdentity) -> URL? {
        self.configuration.codexUpdateFeedURL ?? appIdentity.updateFeedURL
    }

    private func canManageAppBundle(appURL: URL) -> Bool {
        let probeURL = appURL
            .appending(path: "Contents/Resources", directoryHint: .isDirectory)
            .appending(path: ".bibliotheca-permission-check-\(UUID().uuidString)")
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
