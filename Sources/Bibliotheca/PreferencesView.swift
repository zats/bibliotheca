import SwiftUI

enum PreferencesTab: Hashable {
    case onboarding
    case general
    case about
}

@MainActor
struct PreferencesView: View {
    let updater: UpdaterProviding
    @State private var selection: PreferencesTab = .onboarding

    var body: some View {
        TabView(selection: self.$selection) {
            OnboardingSettingsPane()
                .tabItem { Label("Onboarding", systemImage: "sparkles") }
                .tag(PreferencesTab.onboarding)

            GeneralSettingsPane()
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(PreferencesTab.general)

            AboutSettingsPane(updater: self.updater)
                .tabItem { Label("About", systemImage: "info.circle") }
                .tag(PreferencesTab.about)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .frame(width: 500, height: 360)
    }
}
