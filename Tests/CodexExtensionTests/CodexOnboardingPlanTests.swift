import Foundation
import Testing
@testable import CodexSetup

@Suite
struct CodexOnboardingPlanTests {
    @Test
    func pendingPlanHasNoUIRequirement() {
        let plan = CodexOnboardingPlan(snapshot: nil, errorMessage: nil)

        #expect(plan.steps.map(\.id) == ["codex", "extensions", "permissions", "codexRunning", "patch", "updates", "ready"])
        #expect(plan.activeStepID == "codex")
        #expect(plan.activeAction == nil)
    }

    @Test
    func cleanCodexWithDisabledExtensionsActivatesPatch() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1", bundleVersion: "1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .clean,
            appManagementPermissionGranted: true,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts", "colors"],
                disabledExtensionIDs: ["accounts", "colors"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .patchCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "patch")
        #expect(plan.activeAction == .patchCodex)
        #expect(plan.steps.first { $0.id == "codex" }?.status == .complete)
        #expect(plan.steps.first { $0.id == "extensions" }?.status == .complete)
        #expect(plan.steps.first { $0.id == "patch" }?.status == .needsAction)
    }

    @Test
    func actionTitlesComeFromHeadlessActionModel() {
        #expect(CodexSetupRecommendedAction.openCodexDownloadPage.buttonTitle == "Download")
        #expect(CodexSetupRecommendedAction.selectCodexApp.buttonTitle == "Select")
        #expect(CodexSetupRecommendedAction.installExtensionStore.buttonTitle == "Install")
        #expect(CodexSetupRecommendedAction.openAppManagementSettings.buttonTitle == "Allow")
        #expect(CodexSetupRecommendedAction.quitCodex.buttonTitle == "Quit")
        #expect(CodexSetupRecommendedAction.patchCodex.buttonTitle == "Patch")
        #expect(CodexSetupRecommendedAction.launchCodex.buttonTitle == "Launch Codex")
    }

    @Test
    func missingCodexActivatesDownload() {
        let snapshot = CodexSetupSnapshot(
            appURL: nil,
            appIdentity: nil,
            patchState: .missingApp,
            appManagementPermissionGranted: nil,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: false,
                bootloaderVersion: nil,
                extensionIDs: [],
                disabledExtensionIDs: []
            ),
            latestCodexUpdate: nil,
            recommendedAction: .openCodexDownloadPage
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "codex")
        #expect(plan.activeAction == .openCodexDownloadPage)
    }

    @Test
    func permissionStepPrecedesPatchUntilPrompted() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .clean,
            appManagementPermissionGranted: false,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts"],
                disabledExtensionIDs: ["accounts"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .patchCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "permissions")
        #expect(plan.activeAction == .openAppManagementSettings)
    }

    @Test
    func permissionStepPrecedesRollbackWhenPatchedPermissionIsMissing() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: false,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts"],
                disabledExtensionIDs: ["accounts"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .rollbackToCleanCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "permissions")
        #expect(plan.activeAction == .openAppManagementSettings)
    }

    @Test
    func disabledExtensionsManagerActivatesExtensionStoreRepair() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: false,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts", "colors"],
                disabledExtensionIDs: ["accounts", "colors"],
                requiredExtensionIDs: ["extensions-manager"],
                disabledRequiredExtensionIDs: ["extensions-manager"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .installExtensionStore
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "extensions")
        #expect(plan.activeAction == .installExtensionStore)
        #expect(plan.steps.first { $0.id == "extensions" }?.detail == "Enable manager")
    }

    @Test
    func runningCodexStepPrecedesPatchWhenPermissionIsAllowed() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .clean,
            appManagementPermissionGranted: true,
            isCodexRunning: true,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts"],
                disabledExtensionIDs: ["accounts"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .quitCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "codexRunning")
        #expect(plan.activeAction == .quitCodex)
    }

    @Test
    func provisionedClosedCodexActivatesLaunch() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: true,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts"],
                disabledExtensionIDs: ["accounts"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .launchCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "ready")
        #expect(plan.activeAction == .launchCodex)
        #expect(plan.steps.first { $0.id == "codexRunning" }?.status == .complete)
        #expect(plan.steps.first { $0.id == "updates" }?.status == .complete)
    }

    @Test
    func provisionedClosedCodexRequiresAppManagementForMaintenance() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: false,
            isCodexRunning: false,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts", "colors"],
                disabledExtensionIDs: []
            ),
            latestCodexUpdate: nil,
            recommendedAction: .launchCodex
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "permissions")
        #expect(plan.activeAction == .openAppManagementSettings)
        #expect(plan.steps.first { $0.id == "extensions" }?.status == .complete)
        #expect(plan.steps.first { $0.id == "permissions" }?.status == .needsAction)
    }

    @Test
    func provisionedRunningCodexRequiresAppManagementForMaintenance() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: false,
            isCodexRunning: true,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts", "colors"],
                disabledExtensionIDs: []
            ),
            latestCodexUpdate: nil,
            recommendedAction: .ready
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == "permissions")
        #expect(plan.activeAction == .openAppManagementSettings)
        #expect(plan.steps.first { $0.id == "permissions" }?.detail == "Allow App Management")
    }

    @Test
    func provisionedRunningCodexIsReady() {
        let snapshot = CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.1"),
                appASARSHA256: "abc",
                updateFeedURL: nil
            ),
            patchState: .patched,
            appManagementPermissionGranted: true,
            isCodexRunning: true,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.1",
                extensionIDs: ["accounts"],
                disabledExtensionIDs: ["accounts"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .ready
        )

        let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)

        #expect(plan.activeStepID == nil)
        #expect(plan.activeAction == .ready)
        #expect(plan.steps.first { $0.id == "codexRunning" }?.detail == "Running")
    }

    @Test
    func sparkleAppcastSupportsCodexTitleVersion() throws {
        let xml = """
        <rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
          <channel>
            <item>
              <title>26.623.70822</title>
              <enclosure url="https://persistent.oaistatic.com/codex-app-prod/Codex-darwin-arm64-26.623.70822.zip" />
            </item>
          </channel>
        </rss>
        """

        let update = try #require(try SparkleAppcastParser().latestUpdate(from: Data(xml.utf8)))

        #expect(update.version == "26.623.70822")
        #expect(update.downloadURL?.absoluteString == "https://persistent.oaistatic.com/codex-app-prod/Codex-darwin-arm64-26.623.70822.zip")
    }

    @Test
    func sparkleAppcastReturnsAvailableVersionsInOrder() throws {
        let xml = """
        <rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
          <channel>
            <item>
              <title>26.623.70822</title>
              <enclosure url="https://example.com/Codex-26.623.70822.zip" />
            </item>
            <item>
              <title>26.622.10000</title>
              <enclosure url="https://example.com/Codex-26.622.10000.zip" />
            </item>
          </channel>
        </rss>
        """

        let updates = try SparkleAppcastParser().availableUpdates(from: Data(xml.utf8))

        #expect(updates.map(\.version) == ["26.623.70822", "26.622.10000"])
        #expect(updates.map { $0.downloadURL?.absoluteString } == [
            "https://example.com/Codex-26.623.70822.zip",
            "https://example.com/Codex-26.622.10000.zip",
        ])
    }

    @Test
    func sparkleAppcastIgnoresDeltaEnclosuresForRestore() throws {
        let xml = """
        <rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
          <channel>
            <item>
              <title>26.623.70822</title>
              <sparkle:shortVersionString>26.623.70822</sparkle:shortVersionString>
              <enclosure url="https://example.com/Codex-darwin-arm64-26.623.70822.zip" />
              <sparkle:deltas>
                <enclosure url="https://example.com/Codex4559-4441-arm64.delta" sparkle:deltaFrom="4441" />
              </sparkle:deltas>
            </item>
          </channel>
        </rss>
        """

        let update = try #require(try SparkleAppcastParser().latestUpdate(from: Data(xml.utf8)))

        #expect(update.downloadURL?.absoluteString == "https://example.com/Codex-darwin-arm64-26.623.70822.zip")
    }
}
