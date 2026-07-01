import SwiftUI

@MainActor
struct SettingsSection<Content: View>: View {
    let title: LocalizedStringResource
    private let content: () -> Content

    init(_ title: LocalizedStringResource, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.title)
                .font(.subheadline.weight(.semibold))
            self.content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@MainActor
struct SettingsToggleRow: View {
    let title: LocalizedStringResource
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: self.$isOn) {
            Text(self.title)
        }
        .toggleStyle(.checkbox)
    }
}
