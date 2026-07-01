import SwiftUI

@MainActor
struct GeneralSettingsPane: View {
    @State private var startAtLogin = LaunchAtLoginManager.isEnabled
    @State private var launchAtLoginError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SettingsSection("General") {
                SettingsToggleRow(title: "Start at login", isOn: self.$startAtLogin)
            }

            if let launchAtLoginError {
                Text(launchAtLoginError)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            self.startAtLogin = LaunchAtLoginManager.isEnabled
        }
        .onChange(of: self.startAtLogin) { _, newValue in
            do {
                try LaunchAtLoginManager.setEnabled(newValue)
                self.launchAtLoginError = nil
            } catch {
                self.launchAtLoginError = error.localizedDescription
                self.startAtLogin = LaunchAtLoginManager.isEnabled
            }
        }
    }
}
