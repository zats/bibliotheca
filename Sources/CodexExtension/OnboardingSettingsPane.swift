import AppKit
import CodexSetup
import Permiso
import SwiftUI
import UniformTypeIdentifiers

struct OnboardingSettingsPane: View {
    @State private var session = CodexSetupSession()
    @State private var appManagementButtonFrame = CGRect.zero
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let plan = self.session.plan
        let onboardingSteps = plan.steps.filter { $0.id != "permissions" }

        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 14) {
                OnboardingHeader(
                    isRefreshing: self.session.isRefreshing,
                    isBusy: self.session.inProgressAction != nil,
                    refresh: {
                        Task { await self.refresh(checkForUpdates: true) }
                    }
                )

                if let permissionStep = plan.steps.first(where: { $0.id == "permissions" }) {
                    PermissionsSection(
                        step: permissionStep,
                        action: .openAppManagementSettings,
                        appManagementButtonFrame: self.$appManagementButtonFrame,
                        runAction: self.run
                    )
                }

                if self.session.snapshot?.patchState == .patched {
                    RestoreCodexSection(
                        options: self.session.restoreOptions,
                        selectedOptionID: self.$session.selectedRestoreOptionID,
                        isLoading: self.session.isLoadingRestoreOptions,
                        isRestoring: self.session.isRestoringCodex,
                        isCodexConfirmed: self.session.snapshot?.appIdentity != nil,
                        isCodexRunning: self.session.snapshot?.isCodexRunning == true,
                        canManageApps: self.session.snapshot?.appManagementPermissionGranted == true,
                        errorMessage: self.session.restoreErrorMessage,
                        loadOptions: {
                            Task { await self.session.loadRestoreOptions() }
                        },
                        restore: {
                            Task { await self.session.restoreSelectedCleanCodex() }
                        },
                        quitCodex: {
                            Task { _ = await self.session.perform(.quitCodex) }
                        },
                        clearError: self.session.clearRestoreError
                    )
                }

                SettingsSection("Onboarding") {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(onboardingSteps) { step in
                            OnboardingStepRow(
                                step: step,
                                isActive: step.id == plan.activeStepID,
                                action: plan.activeAction,
                                inProgressAction: self.session.inProgressAction,
                                errorMessage: step.id == plan.activeStepID ? plan.errorMessage : nil,
                                appManagementButtonFrame: self.$appManagementButtonFrame,
                                runAction: { action in
                                    self.run(action)
                                },
                                clearError: self.session.clearError
                            )
                            if step.id != onboardingSteps.last?.id {
                                Divider()
                                    .padding(.leading, 28)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task {
            await self.refresh(checkForUpdates: true)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                await self.refresh()
            }
        }
        .onChange(of: self.scenePhase) { _, phase in
            if phase == .active {
                Task { await self.refresh() }
            }
        }
        .onChange(of: self.session.snapshot?.appManagementPermissionGranted) { _, granted in
            if granted == true {
                PermisoAssistant.shared.dismiss()
            }
        }
    }

    private func run(_ action: CodexSetupRecommendedAction) {
        Task {
            if action == .openCodexDownloadPage {
                await MainActor.run {
                    _ = NSWorkspace.shared.open(URL(string: "https://developers.openai.com/codex/app")!)
                }
            }
            if action == .openAppManagementSettings {
                await MainActor.run {
                    guard self.session.snapshot?.appManagementPermissionGranted != true else {
                        PermisoAssistant.shared.dismiss()
                        return
                    }
                    PermisoAssistant.shared.present(
                        panel: .appManagement,
                        sourceFrameInScreen: self.appManagementButtonFrame
                    )
                }
            }
            let outcome = await self.session.perform(action)
            if outcome == .requiresCodexAppSelection, let url = Self.selectCodexAppURL() {
                _ = await self.session.useSelectedCodexApp(url)
            }
        }
    }

    private func refresh(checkForUpdates: Bool = false) async {
        await self.session.refresh(checkForUpdates: checkForUpdates)
        if self.session.snapshot?.appManagementPermissionGranted == true {
            PermisoAssistant.shared.dismiss()
        }
    }

    private static func selectCodexAppURL() -> URL? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.applicationBundle]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.directoryURL = URL(filePath: "/Applications", directoryHint: .isDirectory)
        panel.message = "Select Codex.app"
        return panel.runModal() == .OK ? panel.url : nil
    }
}

struct PermissionsSection: View {
    let step: CodexOnboardingStep
    let action: CodexSetupRecommendedAction
    @Binding var appManagementButtonFrame: CGRect
    let runAction: (CodexSetupRecommendedAction) -> Void

    var body: some View {
        SettingsSection("Permissions") {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("App Management")
                        .font(.body.weight(.medium))
                    Text(self.step.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if self.step.status != .complete {
                    Button(self.action.buttonTitle) {
                        self.runAction(self.action)
                    }
                    .controlSize(.small)
                    .background(ScreenFrameReader(frameInScreen: self.$appManagementButtonFrame))
                }
            }
            .padding(.vertical, 10)
        }
    }
}

struct RestoreCodexSection: View {
    let options: [CodexRestoreOption]
    @Binding var selectedOptionID: CodexRestoreOption.ID?
    let isLoading: Bool
    let isRestoring: Bool
    let isCodexConfirmed: Bool
    let isCodexRunning: Bool
    let canManageApps: Bool
    let errorMessage: String?
    let loadOptions: () -> Void
    let restore: () -> Void
    let quitCodex: () -> Void
    let clearError: () -> Void

    var body: some View {
        SettingsSection("Restore") {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Clean Codex")
                        .font(.body.weight(.medium))
                    Text(self.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 5)

                        Button("Clear", action: self.clearError)
                            .controlSize(.small)
                    }
                }

                Spacer()

                if self.isLoading || self.isRestoring {
                    ProgressView()
                        .controlSize(.small)
                } else if self.options.isEmpty {
                    Button("Rollback", action: self.loadOptions)
                        .controlSize(.small)
                } else {
                    VStack(alignment: .trailing, spacing: 8) {
                        Picker("Version", selection: self.selectedVersionBinding) {
                            ForEach(self.options) { option in
                                Text(option.title).tag(option.id)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                        .frame(width: 230)

                        self.actionButton
                    }
                }
            }
            .padding(.vertical, 10)
        }
    }

    private var detail: String {
        if !self.isCodexConfirmed {
            return "Confirm Codex before restore"
        }
        if self.isCodexRunning {
            return "Quit Codex before restore"
        }
        if !self.canManageApps {
            return "Allow App Management before restore"
        }
        if self.options.isEmpty {
            return "Fetch available versions"
        }
        return "Select clean version"
    }

    private var canRestore: Bool {
        self.isCodexConfirmed && !self.isCodexRunning && self.canManageApps
    }

    @ViewBuilder
    private var actionButton: some View {
        if self.isCodexRunning {
            Button("Quit Codex", action: self.quitCodex)
                .controlSize(.small)
                .frame(minWidth: 92)
                .fixedSize(horizontal: true, vertical: false)
                .disabled(!self.isCodexConfirmed)
        } else {
            Button("Restore", action: self.restore)
                .controlSize(.small)
                .frame(minWidth: 92)
                .fixedSize(horizontal: true, vertical: false)
                .disabled(!self.canRestore)
        }
    }

    private var selectedVersionBinding: Binding<CodexRestoreOption.ID> {
        Binding(
            get: { self.selectedOptionID ?? self.options.first?.id ?? "" },
            set: { self.selectedOptionID = $0 }
        )
    }
}

struct OnboardingHeader: View {
    let isRefreshing: Bool
    let isBusy: Bool
    let refresh: () -> Void

    var body: some View {
        HStack {
            Text("Codex setup")
                .font(.title3.weight(.semibold))

            Spacer()

            Button("Refresh", action: self.refresh)
                .disabled(self.isRefreshing || self.isBusy)
        }
    }
}

extension CodexOnboardingStepStatus {
    var symbol: String {
        switch self {
        case .pending: "..."
        case .complete: "OK"
        case .needsAction: "!"
        case .blocked: "x"
        }
    }

    var style: HierarchicalShapeStyle {
        switch self {
        case .complete: .primary
        case .pending, .needsAction, .blocked: .secondary
        }
    }
}

struct OnboardingStepRow: View {
    let step: CodexOnboardingStep
    let isActive: Bool
    let action: CodexSetupRecommendedAction?
    let inProgressAction: CodexSetupRecommendedAction?
    let errorMessage: String?
    @Binding var appManagementButtonFrame: CGRect
    let runAction: (CodexSetupRecommendedAction) -> Void
    let clearError: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(self.step.status.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(self.step.status.style)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 3) {
                Text(self.step.title)
                    .font(.body.weight(.medium))
                Text(self.step.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 5)

                    HStack {
                        if let action {
                            Button("Retry") {
                                self.runAction(action)
                            }
                            .controlSize(.small)
                            .disabled(self.isInProgress)
                        }

                        Button("Clear", action: self.clearError)
                            .controlSize(.small)
                    }
                    .padding(.top, 2)
                }
            }

            Spacer()

            if self.isInProgress {
                ProgressView()
                    .controlSize(.small)
            } else if self.isActive, let action, action != .ready {
                Button(action.buttonTitle) {
                    self.runAction(action)
                }
                .controlSize(.small)
                .background(self.frameReader(for: action))
            }
        }
        .padding(.vertical, 10)
        .opacity(self.opacity)
    }

    @ViewBuilder
    private func frameReader(for action: CodexSetupRecommendedAction) -> some View {
        if action == .openAppManagementSettings {
            ScreenFrameReader(frameInScreen: self.$appManagementButtonFrame)
        }
    }

    private var opacity: Double {
        if self.step.status == .complete {
            return 0.45
        }
        return self.isActive ? 1 : 0.55
    }

    private var isInProgress: Bool {
        self.isActive && self.action == self.inProgressAction
    }
}

private struct ScreenFrameReader: NSViewRepresentable {
    @Binding var frameInScreen: CGRect

    func makeNSView(context: Context) -> ScreenFrameTrackingView {
        let view = ScreenFrameTrackingView()
        view.onFrameChange = { frame in
            self.frameInScreen = frame
        }
        return view
    }

    func updateNSView(_ nsView: ScreenFrameTrackingView, context: Context) {
        nsView.onFrameChange = { frame in
            self.frameInScreen = frame
        }
        nsView.reportFrame()
    }
}

private final class ScreenFrameTrackingView: NSView {
    var onFrameChange: ((CGRect) -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        self.reportFrame()
    }

    override func layout() {
        super.layout()
        self.reportFrame()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        self.reportFrame()
    }

    func reportFrame() {
        guard let window else {
            return
        }

        let frame = window.convertToScreen(self.convert(self.bounds, to: nil))
        DispatchQueue.main.async { [onFrameChange] in
            onFrameChange?(frame)
        }
    }
}
