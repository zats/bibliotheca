import Foundation
import Testing
@testable import CodexSetup

@Suite
struct CodexUpdateRepatchPolicyTests {
    @Test
    func ignoresNormallyPatchedCodex() {
        let snapshot = Self.snapshot(patchState: .patched, appManagementPermissionGranted: true, isCodexRunning: true)

        #expect(CodexUpdateRepatchPolicy.plan(for: snapshot) == .none)
    }

    @Test
    func asksForPermissionBeforeRepatchingUpdatedCodex() {
        let snapshot = Self.snapshot(
            patchState: .updatedAfterProvisioning(previousVersion: "26.1", currentVersion: "26.2"),
            appManagementPermissionGranted: false,
            isCodexRunning: false
        )

        #expect(CodexUpdateRepatchPolicy.plan(for: snapshot) == .needsAppManagementPermission)
    }

    @Test
    func quitsBeforeRepatchingRunningUpdatedCodex() {
        let snapshot = Self.snapshot(
            patchState: .updatedAfterProvisioning(previousVersion: "26.1", currentVersion: "26.2"),
            appManagementPermissionGranted: true,
            isCodexRunning: true
        )

        #expect(CodexUpdateRepatchPolicy.plan(for: snapshot) == .quitPatchAndLaunch)
    }

    @Test
    func patchesClosedUpdatedCodex() {
        let snapshot = Self.snapshot(
            patchState: .updatedAfterProvisioning(previousVersion: "26.1", currentVersion: "26.2"),
            appManagementPermissionGranted: true,
            isCodexRunning: false
        )

        #expect(CodexUpdateRepatchPolicy.plan(for: snapshot) == .patchAndLaunch)
    }

    private static func snapshot(
        patchState: CodexPatchState,
        appManagementPermissionGranted: Bool?,
        isCodexRunning: Bool
    ) -> CodexSetupSnapshot {
        CodexSetupSnapshot(
            appURL: URL(filePath: "/Applications/Codex.app"),
            appIdentity: CodexAppIdentity(
                bundleIdentifier: "com.openai.codex",
                version: CodexAppVersion(shortVersion: "26.2"),
                appASARSHA256: "new",
                updateFeedURL: nil
            ),
            patchState: patchState,
            appManagementPermissionGranted: appManagementPermissionGranted,
            isCodexRunning: isCodexRunning,
            extensionStoreStatus: CodexExtensionStoreStatus(
                exists: true,
                bootloaderVersion: "26.2",
                extensionIDs: ["accounts", "colors"],
                disabledExtensionIDs: ["accounts", "colors"]
            ),
            latestCodexUpdate: nil,
            recommendedAction: .ready
        )
    }
}
