import AppKit
import BibliothecaSetup
import SwiftUI

@main
struct BibliothecaApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("BibliothecaLifecycleKeepalive") {
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
    private let setupRuntime = BibliothecaSetupRuntime()
    private var updateRepatchTask: Task<Void, Never>?
    private var isAutoRepatching = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        self.installStatusItem()
        self.startUpdateRepatchMonitor()
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
        self.updateRepatchTask?.cancel()
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
    }

    @objc private func openSettings() {
        NotificationCenter.default.post(name: .codexExtensionOpenSettings, object: nil)
    }

    @objc private func launchCodex() {
        Task { @MainActor in
            do {
                try await self.setupRuntime.launchCodex()
            } catch {
                self.openSettings()
            }
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func installStatusItem() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.autosaveName = "bibliotheca"

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "puzzlepiece.extension.fill", accessibilityDescription: "Bibliotheca")
            button.image?.isTemplate = true
            button.toolTip = "Bibliotheca"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open", action: #selector(self.openSettings), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "Launch Codex", action: #selector(self.launchCodex), keyEquivalent: "l"))
        menu.addItem(NSMenuItem(title: "Settings", action: #selector(self.openSettings), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(self.quit), keyEquivalent: "q"))

        statusItem.menu = menu
        self.statusItem = statusItem
    }

    private func startUpdateRepatchMonitor() {
        self.updateRepatchTask?.cancel()
        self.updateRepatchTask = Task { @MainActor in
            while !Task.isCancelled {
                await self.repatchUpdatedCodexIfNeeded()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func repatchUpdatedCodexIfNeeded() async {
        guard !self.isAutoRepatching else {
            return
        }
        self.isAutoRepatching = true
        defer { self.isAutoRepatching = false }

        do {
            let outcome = try await self.setupRuntime.repatchUpdatedCodexIfNeeded()
            if outcome == .needsAppManagementPermission {
                self.openSettings()
            }
        } catch {
            self.openSettings()
        }
    }
}

extension Notification.Name {
    static let codexExtensionOpenSettings = Notification.Name("codexExtensionOpenSettings")
}
