import Foundation

public struct CodexAppVersion: Equatable, Sendable {
    public var shortVersion: String
    public var bundleVersion: String?
    public var chromiumVersion: String?
    public var chromiumBundleVersion: String?

    public init(shortVersion: String, bundleVersion: String? = nil, chromiumVersion: String? = nil, chromiumBundleVersion: String? = nil) {
        self.shortVersion = shortVersion
        self.bundleVersion = bundleVersion
        self.chromiumVersion = chromiumVersion
        self.chromiumBundleVersion = chromiumBundleVersion
    }

    public var displayString: String {
        if let bundleVersion {
            "\(self.shortVersion) (\(bundleVersion))"
        } else {
            self.shortVersion
        }
    }
}

public struct CodexAppIdentity: Equatable, Sendable {
    public var bundleIdentifier: String?
    public var version: CodexAppVersion
    public var appASARSHA256: String?
    public var updateFeedURL: URL?

    public init(bundleIdentifier: String?, version: CodexAppVersion, appASARSHA256: String?, updateFeedURL: URL?) {
        self.bundleIdentifier = bundleIdentifier
        self.version = version
        self.appASARSHA256 = appASARSHA256
        self.updateFeedURL = updateFeedURL
    }
}

public struct CodexExtensionStoreStatus: Equatable, Sendable {
    public var exists: Bool
    public var bootloaderVersion: String?
    public var extensionIDs: [String]
    public var disabledExtensionIDs: Set<String>
    public var requiredExtensionIDs: Set<String>
    public var disabledRequiredExtensionIDs: Set<String>

    public init(
        exists: Bool,
        bootloaderVersion: String?,
        extensionIDs: [String],
        disabledExtensionIDs: Set<String>,
        requiredExtensionIDs: Set<String> = ["extensions-manager"],
        disabledRequiredExtensionIDs: Set<String> = []
    ) {
        self.exists = exists
        self.bootloaderVersion = bootloaderVersion
        self.extensionIDs = extensionIDs
        self.disabledExtensionIDs = disabledExtensionIDs
        self.requiredExtensionIDs = requiredExtensionIDs
        self.disabledRequiredExtensionIDs = disabledRequiredExtensionIDs
    }

    public var allUserExtensionsDisabled: Bool {
        Set(self.extensionIDs).isSubset(of: self.disabledExtensionIDs)
    }

    public var requiredExtensionsEnabled: Bool {
        self.requiredExtensionIDs == ["extensions-manager"] && self.disabledRequiredExtensionIDs.isEmpty
    }
}

struct CodexProvisioningReceipt: Codable, Equatable, Sendable {
    var appPath: String
    var appVersion: String
    var appASARSHA256: String?
    var cleanAppASARSHA256: String?
    var patchedAppASARSHA256: String?
    var backupDirectoryPath: String?
    var provisionedAt: Date
}

public struct CodexUpdateInfo: Equatable, Sendable {
    public var version: String
    public var downloadURL: URL?

    public init(version: String, downloadURL: URL?) {
        self.version = version
        self.downloadURL = downloadURL
    }
}

public struct CodexRestoreOption: Identifiable, Equatable, Sendable {
    public var version: String
    public var downloadURL: URL?
    public var isLatest: Bool

    public init(version: String, downloadURL: URL?, isLatest: Bool) {
        self.version = version
        self.downloadURL = downloadURL
        self.isLatest = isLatest
    }

    public var id: String {
        self.version
    }

    public var title: String {
        self.isLatest ? "\(self.version) (latest)" : self.version
    }
}

public enum CodexRestoreProgressPhase: String, Sendable {
    case preparing
    case downloading
    case validating
    case extracting
    case replacing
    case cleaningUp
    case complete
}

public struct CodexRestoreProgress: Equatable, Sendable {
    public var phase: CodexRestoreProgressPhase
    public var fraction: Double
    public var detail: String

    public init(phase: CodexRestoreProgressPhase, fraction: Double, detail: String) {
        self.phase = phase
        self.fraction = min(1, max(0, fraction))
        self.detail = detail
    }

    public var percent: Int {
        Int((self.fraction * 100).rounded())
    }
}

public typealias CodexRestoreProgressHandler = @Sendable (CodexRestoreProgress) async -> Void

public enum CodexPatchState: Equatable, Sendable {
    case missingApp
    case clean
    case patched
    case updatedAfterProvisioning(previousVersion: String, currentVersion: String)
    case damagedPatchedApp
    case unknown(String)
}

public enum CodexSetupRecommendedAction: Equatable, Sendable {
    case openCodexDownloadPage
    case selectCodexApp
    case installExtensionStore
    case openAppManagementSettings
    case quitCodex
    case patchCodex
    case rollbackToCleanCodex
    case repairFromLatestCodex
    case confirmAutomaticPatchAfterCodexUpdate
    case uninstallCodexExtension
    case launchCodex
    case ready
}

public struct CodexSetupSnapshot: Equatable, Sendable {
    public var appURL: URL?
    public var appIdentity: CodexAppIdentity?
    public var patchState: CodexPatchState
    public var appManagementPermissionGranted: Bool?
    public var isCodexRunning: Bool
    public var extensionStoreStatus: CodexExtensionStoreStatus
    public var latestCodexUpdate: CodexUpdateInfo?
    public var recommendedAction: CodexSetupRecommendedAction

    public init(
        appURL: URL?,
        appIdentity: CodexAppIdentity?,
        patchState: CodexPatchState,
        appManagementPermissionGranted: Bool?,
        isCodexRunning: Bool,
        extensionStoreStatus: CodexExtensionStoreStatus,
        latestCodexUpdate: CodexUpdateInfo?,
        recommendedAction: CodexSetupRecommendedAction
    ) {
        self.appURL = appURL
        self.appIdentity = appIdentity
        self.patchState = patchState
        self.appManagementPermissionGranted = appManagementPermissionGranted
        self.isCodexRunning = isCodexRunning
        self.extensionStoreStatus = extensionStoreStatus
        self.latestCodexUpdate = latestCodexUpdate
        self.recommendedAction = recommendedAction
    }
}

struct CodexSetupConfiguration: Sendable {
    var candidateAppURLs: [URL]
    var extensionsRootURL: URL
    var provisioningReceiptURL: URL
    var bundledExtensionsRootURL: URL
    var codexUpdateFeedURL: URL?

    init(
        candidateAppURLs: [URL],
        extensionsRootURL: URL,
        provisioningReceiptURL: URL,
        bundledExtensionsRootURL: URL,
        codexUpdateFeedURL: URL? = nil
    ) {
        self.candidateAppURLs = candidateAppURLs
        self.extensionsRootURL = extensionsRootURL
        self.provisioningReceiptURL = provisioningReceiptURL
        self.bundledExtensionsRootURL = bundledExtensionsRootURL
        self.codexUpdateFeedURL = codexUpdateFeedURL
    }
}

enum CodexSetupError: LocalizedError {
    case codexAppMissing
    case invalidCodexBundle(URL)
    case bundledExtensionsMissing(URL)
    case invalidExtensionManifest(URL)
    case updateFeedMissing
    case updateFeedMalformed
    case updateDownloadInvalid(URL)
    case asarToolMissing
    case patchPatternMissing(String)
    case processFailed(executable: String, status: Int32, output: String)
    case rollbackBackupMissing
    case provisioningReceiptInvalid
    case appManagementPermissionRequired
    case codexStillRunning

    var errorDescription: String? {
        switch self {
        case .codexAppMissing:
            "Codex app is missing."
        case .invalidCodexBundle(let url):
            "Invalid Codex bundle at \(url.path)."
        case .bundledExtensionsMissing(let url):
            "Bundled extensions are missing at \(url.path)."
        case .invalidExtensionManifest(let url):
            "Invalid extension manifest at \(url.path)."
        case .updateFeedMissing:
            "Codex update feed is missing."
        case .updateFeedMalformed:
            "Codex update feed is malformed."
        case .updateDownloadInvalid(let url):
            "Downloaded Codex update is not a valid archive: \(url.absoluteString)"
        case .asarToolMissing:
            "asar tool is missing."
        case .patchPatternMissing(let description):
            "Patch pattern not found: \(description)."
        case .processFailed(let executable, let status, let output):
            "\(executable) failed with status \(status): \(output)"
        case .rollbackBackupMissing:
            "Rollback backup is missing."
        case .provisioningReceiptInvalid:
            "Provisioning receipt could not be saved."
        case .appManagementPermissionRequired:
            "Enable App Management for Codex Extension in Privacy & Security, then retry."
        case .codexStillRunning:
            "Quit Codex, then retry."
        }
    }
}
