import AppKit
import SwiftUI

struct HiddenWindowView: View {
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Color.clear
            .frame(width: 20, height: 20)
            .onReceive(NotificationCenter.default.publisher(for: .codexExtensionOpenSettings)) { _ in
                self.openSettings()
                DispatchQueue.main.async {
                    NSApp.activate(ignoringOtherApps: true)
                    NSApp.windows
                        .filter { $0.title == "Onboarding" || $0.identifier?.rawValue == "com_apple_SwiftUI_Settings_window" }
                        .forEach { window in
                            window.makeKeyAndOrderFront(nil)
                            window.orderFrontRegardless()
                        }
                }
            }
            .onAppear {
                if let window = NSApp.windows.first(where: { $0.title == "BibliothecaLifecycleKeepalive" }) {
                    window.styleMask = [.borderless]
                    window.collectionBehavior = [.auxiliary, .ignoresCycle, .transient, .canJoinAllSpaces]
                    window.isExcludedFromWindowsMenu = true
                    window.level = .floating
                    window.isOpaque = false
                    window.alphaValue = 0
                    window.backgroundColor = .clear
                    window.hasShadow = false
                    window.ignoresMouseEvents = true
                    window.canHide = false
                    window.setContentSize(NSSize(width: 1, height: 1))
                    window.setFrameOrigin(NSPoint(x: -5000, y: -5000))
                }
            }
    }
}
