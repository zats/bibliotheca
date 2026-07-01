import Foundation

public struct CodexOnboardingPlan: Equatable, Sendable {
    public var steps: [CodexOnboardingStep]
    public var activeStepID: String?
    public var activeAction: CodexSetupRecommendedAction?
    public var errorMessage: String?

    public init(snapshot: CodexSetupSnapshot?, errorMessage: String?) {
        let steps = CodexOnboardingPlan.steps(from: snapshot)
        self.steps = steps
        self.activeStepID = steps.first { $0.status != .complete }?.id
        if self.activeStepID == "permissions" {
            self.activeAction = .openAppManagementSettings
        } else {
            self.activeAction = snapshot?.recommendedAction
        }
        self.errorMessage = errorMessage
    }
}

public struct CodexOnboardingStep: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var detail: String
    public var status: CodexOnboardingStepStatus

    public init(id: String, title: String, detail: String, status: CodexOnboardingStepStatus) {
        self.id = id
        self.title = title
        self.detail = detail
        self.status = status
    }
}

public enum CodexOnboardingStepStatus: Equatable, Sendable {
    case pending
    case complete
    case needsAction
    case blocked
}

public enum CodexSetupActionOutcome: Equatable, Sendable {
    case completed
    case requiresCodexAppSelection
    case failed(String)
}

extension CodexSetupRecommendedAction {
    public var buttonTitle: String {
        switch self {
        case .openCodexDownloadPage:
            return "Download"
        case .selectCodexApp:
            return "Select"
        case .installExtensionStore:
            return "Prepare"
        case .openAppManagementSettings:
            return "Allow"
        case .quitCodex:
            return "Quit"
        case .patchCodex:
            return "Patch"
        case .rollbackToCleanCodex:
            return "Rollback"
        case .repairFromLatestCodex:
            return "Repair"
        case .confirmAutomaticPatchAfterCodexUpdate:
            return "Confirm"
        case .uninstallCodexExtension:
            return "Uninstall"
        case .launchCodex:
            return "Launch Codex"
        case .ready:
            return "Refresh"
        }
    }
}

extension CodexOnboardingPlan {
    private static func steps(from snapshot: CodexSetupSnapshot?) -> [CodexOnboardingStep] {
        guard let snapshot else {
            return [
                CodexOnboardingStep(id: "codex", title: "Codex", detail: "Checking installation", status: .pending),
                CodexOnboardingStep(id: "permissions", title: "Permissions", detail: "Waiting for Codex", status: .pending),
                CodexOnboardingStep(id: "codexRunning", title: "Codex", detail: "Waiting for Codex", status: .pending),
                CodexOnboardingStep(id: "patch", title: "Patch", detail: "Waiting for Codex", status: .pending),
                CodexOnboardingStep(id: "updates", title: "Updates", detail: "Waiting for setup", status: .pending),
                CodexOnboardingStep(id: "ready", title: "Ready", detail: "Waiting for setup", status: .pending),
            ]
        }

        return [
            CodexOnboardingStep(
                id: "codex",
                title: "Codex",
                detail: Self.codexDetail(snapshot),
                status: snapshot.appIdentity == nil ? .blocked : .complete
            ),
            CodexOnboardingStep(
                id: "permissions",
                title: "Permissions",
                detail: Self.permissionDetail(snapshot),
                status: Self.permissionStatus(snapshot)
            ),
            CodexOnboardingStep(
                id: "codexRunning",
                title: "Codex",
                detail: Self.runningDetail(snapshot),
                status: Self.runningStatus(snapshot)
            ),
            CodexOnboardingStep(
                id: "patch",
                title: "Patch",
                detail: Self.patchDetail(snapshot),
                status: Self.patchStatus(snapshot)
            ),
            CodexOnboardingStep(
                id: "updates",
                title: "Updates",
                detail: Self.updateDetail(snapshot),
                status: Self.updateStatus(snapshot)
            ),
            CodexOnboardingStep(
                id: "ready",
                title: "Ready",
                detail: Self.readyDetail(snapshot),
                status: Self.readyStatus(snapshot)
            ),
        ]
    }

    private static func codexDetail(_ snapshot: CodexSetupSnapshot) -> String {
        guard let identity = snapshot.appIdentity else {
            return "Select Codex.app to continue"
        }
        return identity.version.displayString
    }

    private static func patchDetail(_ snapshot: CodexSetupSnapshot) -> String {
        if !snapshot.extensionStoreStatus.exists || !snapshot.extensionStoreStatus.requiredExtensionsEnabled {
            return "Prepare Codex"
        }

        switch snapshot.patchState {
        case .missingApp:
            return "Codex not found"
        case .clean:
            return "Clean app"
        case .patched:
            return "Provisioned"
        case .updatedAfterProvisioning(let previousVersion, let currentVersion):
            return "\(previousVersion) -> \(currentVersion)"
        case .damagedPatchedApp:
            return "Repair from latest Codex"
        case .unknown(let reason):
            return reason
        }
    }

    private static func patchStatus(_ snapshot: CodexSetupSnapshot) -> CodexOnboardingStepStatus {
        if !snapshot.extensionStoreStatus.exists || !snapshot.extensionStoreStatus.requiredExtensionsEnabled {
            return .needsAction
        }

        switch snapshot.patchState {
        case .patched:
            return .complete
        case .missingApp, .unknown, .damagedPatchedApp:
            return .blocked
        case .clean, .updatedAfterProvisioning:
            return .needsAction
        }
    }

    private static func updateDetail(_ snapshot: CodexSetupSnapshot) -> String {
        if let latestCodexUpdate = snapshot.latestCodexUpdate {
            return "Latest \(latestCodexUpdate.version)"
        }

        if snapshot.appIdentity?.updateFeedURL == nil {
            return "No feed in bundle"
        }

        return "Refresh to check"
    }

    private static func updateStatus(_ snapshot: CodexSetupSnapshot) -> CodexOnboardingStepStatus {
        guard let latestCodexUpdate = snapshot.latestCodexUpdate,
              let currentVersion = snapshot.appIdentity?.version.shortVersion
        else {
            return .complete
        }

        return latestCodexUpdate.version == currentVersion ? .complete : .needsAction
    }

    private static func readyDetail(_ snapshot: CodexSetupSnapshot) -> String {
        if Self.permissionStatus(snapshot) != .complete {
            return "Waiting for permissions"
        }
        return Self.actionDetail(snapshot.recommendedAction)
    }

    private static func readyStatus(_ snapshot: CodexSetupSnapshot) -> CodexOnboardingStepStatus {
        guard Self.permissionStatus(snapshot) == .complete else {
            return .pending
        }
        return snapshot.recommendedAction == .ready ? .complete : .needsAction
    }

    private static func actionDetail(_ action: CodexSetupRecommendedAction) -> String {
        switch action {
        case .openCodexDownloadPage:
            return "Download Codex"
        case .selectCodexApp:
            return "Select Codex.app"
        case .installExtensionStore:
            return "Prepare extensions"
        case .openAppManagementSettings:
            return "Allow App Management"
        case .quitCodex:
            return "Quit Codex"
        case .patchCodex:
            return "Patch Codex"
        case .rollbackToCleanCodex:
            return "Rollback available"
        case .repairFromLatestCodex:
            return "Download clean Codex"
        case .confirmAutomaticPatchAfterCodexUpdate:
            return "Confirm automatic patch"
        case .uninstallCodexExtension:
            return "Uninstall"
        case .launchCodex:
            return "Launch Codex"
        case .ready:
            return "All systems go"
        }
    }

    private static func permissionDetail(_ snapshot: CodexSetupSnapshot) -> String {
        switch snapshot.appManagementPermissionGranted {
        case true:
            return "App Management allowed"
        case false:
            return "Allow App Management"
        case nil:
            return "Waiting for Codex"
        }
    }

    private static func permissionStatus(_ snapshot: CodexSetupSnapshot) -> CodexOnboardingStepStatus {
        if snapshot.appManagementPermissionGranted == true {
            return .complete
        }
        if snapshot.extensionStoreStatus.exists && snapshot.extensionStoreStatus.requiredExtensionsEnabled {
            return .needsAction
        }
        return .pending
    }

    private static func isProvisionedLaunchState(_ snapshot: CodexSetupSnapshot) -> Bool {
        guard case .patched = snapshot.patchState else {
            return false
        }
        return snapshot.recommendedAction == .launchCodex || snapshot.recommendedAction == .ready
    }

    private static func runningDetail(_ snapshot: CodexSetupSnapshot) -> String {
        snapshot.isCodexRunning ? "Running" : "Closed"
    }

    private static func runningStatus(_ snapshot: CodexSetupSnapshot) -> CodexOnboardingStepStatus {
        if Self.isProvisionedLaunchState(snapshot) {
            return .complete
        }
        guard snapshot.appManagementPermissionGranted == true else {
            return .pending
        }
        if snapshot.patchState == .patched {
            return .complete
        }
        return snapshot.isCodexRunning ? .needsAction : .complete
    }
}
