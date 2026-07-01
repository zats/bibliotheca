import AppKit
import CodexSetup
import SwiftUI

@main
struct CodexExtensionApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("CodexExtensionLifecycleKeepalive") {
            HiddenWindowView()
        }
        .defaultSize(width: 20, height: 20)
        .windowStyle(.hiddenTitleBar)

        Settings {
            PreferencesView(updater: self.appDelegate.updaterController)
        }
        .defaultSize(width: 500, height: 360)
        .windowResizability(.contentSize)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let updaterController: UpdaterProviding = SparkleUpdaterController()

    private var statusItem: NSStatusItem?
    private let setupRuntime = CodexSetupRuntime()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        self.installStatusItem()
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(300))
            let snapshot = await self.setupRuntime.inspect(checkForUpdates: true)
            let plan = CodexOnboardingPlan(snapshot: snapshot, errorMessage: nil)
            if plan.steps.contains(where: { $0.status != .complete }) {
                self.openSettings()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
    }

    @objc private func openSettings() {
        NotificationCenter.default.post(name: .codexExtensionOpenSettings, object: nil)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func installStatusItem() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.autosaveName = "codex-extension"

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "puzzlepiece.extension", accessibilityDescription: "Codex Extension")
            button.image?.isTemplate = true
            button.toolTip = "Codex Extension"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open", action: #selector(self.openSettings), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "Settings", action: #selector(self.openSettings), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(self.quit), keyEquivalent: "q"))

        statusItem.menu = menu
        self.statusItem = statusItem
    }
}

extension Notification.Name {
    static let codexExtensionOpenSettings = Notification.Name("codexExtensionOpenSettings")
}
