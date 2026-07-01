import Foundation
import Observation

@MainActor
@Observable
public final class BibliothecaSetupSession {
    public var snapshot: BibliothecaSetupSnapshot?
    public var isRefreshing = false
    public var inProgressAction: BibliothecaSetupRecommendedAction?
    public var errorMessage: String?
    public var restoreOptions: [CodexRestoreOption] = []
    public var selectedRestoreOptionID: CodexRestoreOption.ID?
    public var isLoadingRestoreOptions = false
    public var isRestoringCodex = false
    public var restoreProgress: CodexRestoreProgress?
    public var restoreErrorMessage: String?

    private let runtime: BibliothecaSetupRuntime
    private var selectedAppURL: URL?

    public var plan: CodexOnboardingPlan {
        CodexOnboardingPlan(snapshot: self.snapshot, errorMessage: self.errorMessage)
    }

    public var selectedRestoreOption: CodexRestoreOption? {
        guard let selectedRestoreOptionID else {
            return self.restoreOptions.first
        }
        return self.restoreOptions.first { $0.id == selectedRestoreOptionID }
    }

    public convenience init() {
        self.init(runtime: BibliothecaSetupRuntime())
    }

    init(runtime: BibliothecaSetupRuntime) {
        self.runtime = runtime
    }

    public func refresh(checkForUpdates: Bool = false) async {
        guard self.inProgressAction == nil else {
            return
        }
        self.isRefreshing = true
        self.errorMessage = nil
        self.snapshot = await self.runtime.inspect(
            appURL: self.selectedAppURL,
            checkForUpdates: checkForUpdates
        )
        self.clearResolvedRestoreError()
        self.isRefreshing = false
    }

    public func perform(_ action: BibliothecaSetupRecommendedAction) async -> BibliothecaSetupActionOutcome {
        guard self.inProgressAction == nil else {
            return .failed("Another setup action is already running.")
        }

        self.errorMessage = nil
        self.inProgressAction = action
        defer { self.inProgressAction = nil }

        let outcome: BibliothecaSetupActionOutcome
        switch action {
        case .openCodexDownloadPage:
            outcome = .completed
        case .selectCodexApp:
            outcome = .requiresCodexAppSelection
        case .installExtensionStore:
            outcome = await self.installBundledExtensionsDisabled()
        case .openAppManagementSettings:
            outcome = .completed
        case .quitCodex:
            outcome = await self.quitCodex()
        case .launchCodex:
            outcome = await self.launchCodex()
        case .patchCodex:
            outcome = await self.patchCodex()
        case .rollbackToCleanCodex:
            outcome = await self.rollbackCodex()
        case .repairFromLatestCodex:
            outcome = await self.repairFromLatestCodex()
        case .confirmAutomaticPatchAfterCodexUpdate:
            outcome = await self.patchCodex()
        case .uninstallBibliotheca:
            outcome = await self.uninstallBibliotheca()
        case .ready:
            await self.refresh()
            outcome = .completed
        }

        if case .failed(let message) = outcome {
            self.errorMessage = message
        }
        return outcome
    }

    public func useSelectedCodexApp(_ url: URL) async -> BibliothecaSetupActionOutcome {
        self.errorMessage = nil
        self.selectedAppURL = url
        await self.refresh()

        if self.snapshot?.appIdentity == nil {
            let outcome = BibliothecaSetupActionOutcome.failed("Selected app is not Codex.app.")
            if case .failed(let message) = outcome {
                self.errorMessage = message
            }
            return outcome
        }

        return .completed
    }

    public func clearError() {
        self.errorMessage = nil
    }

    public func clearRestoreError() {
        self.restoreErrorMessage = nil
    }

    private func clearResolvedRestoreError() {
        guard let restoreErrorMessage else {
            return
        }

        if restoreErrorMessage == "Quit Codex, then retry.", self.snapshot?.isCodexRunning == false {
            self.restoreErrorMessage = nil
        }
        if restoreErrorMessage == "Quit Codex before restore.", self.snapshot?.isCodexRunning == false {
            self.restoreErrorMessage = nil
        }
        if restoreErrorMessage == "Allow App Management before restore.", self.snapshot?.appManagementPermissionGranted == true {
            self.restoreErrorMessage = nil
        }
        if restoreErrorMessage == "Confirm Codex before restore.", self.snapshot?.appIdentity != nil {
            self.restoreErrorMessage = nil
        }
    }

    public func loadRestoreOptions() async {
        guard !self.isLoadingRestoreOptions, !self.isRestoringCodex else {
            return
        }

        self.restoreErrorMessage = nil
        self.isLoadingRestoreOptions = true
        defer { self.isLoadingRestoreOptions = false }

        do {
            let options = try await self.runtime.availableRestoreOptions(appURL: self.selectedAppURL)
            self.restoreOptions = options
            self.selectedRestoreOptionID = options.first?.id
        } catch {
            self.restoreErrorMessage = error.localizedDescription
        }
    }

    public func restoreSelectedCleanCodex() async {
        guard !self.isLoadingRestoreOptions, !self.isRestoringCodex else {
            return
        }
        guard let selectedRestoreOption else {
            self.restoreErrorMessage = "Select a Codex version."
            return
        }
        guard self.snapshot?.appIdentity != nil else {
            self.restoreErrorMessage = "Confirm Codex before restore."
            return
        }
        guard self.snapshot?.isCodexRunning != true else {
            self.restoreErrorMessage = "Quit Codex before restore."
            return
        }
        guard self.snapshot?.appManagementPermissionGranted == true else {
            self.restoreErrorMessage = "Allow App Management before restore."
            return
        }

        self.restoreErrorMessage = nil
        self.restoreProgress = CodexRestoreProgress(phase: .preparing, fraction: 0, detail: "Starting restore")
        self.isRestoringCodex = true
        defer {
            self.isRestoringCodex = false
            if self.restoreErrorMessage != nil {
                self.restoreProgress = nil
            }
        }

        do {
            try await self.runtime.restoreCleanCodex(
                selectedRestoreOption,
                appURL: self.selectedAppURL,
                progress: { progress in
                    await MainActor.run {
                        self.restoreProgress = progress
                    }
                }
            )
            self.restoreOptions = []
            self.selectedRestoreOptionID = nil
            await self.refresh()
            self.restoreProgress = nil
        } catch {
            self.restoreErrorMessage = error.localizedDescription
        }
    }

    private func installBundledExtensionsDisabled() async -> BibliothecaSetupActionOutcome {
        guard self.snapshot?.appIdentity != nil else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.installBundledExtensionsDisabled(appURL: self.selectedAppURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func patchCodex() async -> BibliothecaSetupActionOutcome {
        guard let snapshot, let appURL = snapshot.appURL, snapshot.appIdentity != nil else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.patchCodex(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func quitCodex() async -> BibliothecaSetupActionOutcome {
        guard let snapshot, let appURL = snapshot.appURL, snapshot.appIdentity != nil else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.quitCodex(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func launchCodex() async -> BibliothecaSetupActionOutcome {
        guard let snapshot, let appURL = snapshot.appURL, snapshot.appIdentity != nil else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.launchCodex(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func rollbackCodex() async -> BibliothecaSetupActionOutcome {
        guard let appURL = self.snapshot?.appURL else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.rollbackCodex(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func repairFromLatestCodex() async -> BibliothecaSetupActionOutcome {
        guard let snapshot, let appURL = snapshot.appURL, snapshot.appIdentity != nil else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.repairFromLatestCodex(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    private func uninstallBibliotheca() async -> BibliothecaSetupActionOutcome {
        guard let appURL = self.snapshot?.appURL else {
            return .failed("Select Codex.app first.")
        }

        do {
            try await self.runtime.uninstallBibliotheca(appURL: appURL)
            await self.refresh()
            return .completed
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}
