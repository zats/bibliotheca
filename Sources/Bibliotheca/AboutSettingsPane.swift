import SwiftUI

@MainActor
struct AboutSettingsPane: View {
    let updater: UpdaterProviding
    @State private var checksForUpdatesAutomatically = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AboutVersionSection(version: Self.versionString)

            SettingsSection("Updates") {
                VStack(alignment: .leading, spacing: 12) {
                    SettingsToggleRow(
                        title: "Check for updates automatically",
                        isOn: self.$checksForUpdatesAutomatically)
                    Button("Check for Updates") {
                        self.updater.checkForUpdates(nil)
                    }
                    .buttonStyle(.glass)
                    .disabled(!self.updater.canCheckForUpdates)

                    if let reason = self.updater.unavailableReason {
                        Text(reason)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            self.checksForUpdatesAutomatically = self.updater.automaticallyChecksForUpdates
        }
        .onChange(of: self.checksForUpdatesAutomatically) { _, newValue in
            self.updater.automaticallyChecksForUpdates = newValue
            self.updater.automaticallyDownloadsUpdates = newValue
        }
    }

    private static var versionString: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(version) (\(build))"
    }
}

struct AboutVersionSection: View {
    let version: String

    var body: some View {
        SettingsSection("About") {
            LabeledContent("Current version", value: self.version)
        }
    }
}
