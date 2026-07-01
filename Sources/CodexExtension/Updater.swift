import Foundation
import Sparkle

@MainActor
protocol UpdaterProviding: AnyObject {
    var automaticallyChecksForUpdates: Bool { get set }
    var automaticallyDownloadsUpdates: Bool { get set }
    var canCheckForUpdates: Bool { get }
    var unavailableReason: String? { get }
    func checkForUpdates(_ sender: Any?)
}

@MainActor
final class SparkleUpdaterController: NSObject, UpdaterProviding {
    private lazy var controller = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: self,
        userDriverDelegate: nil)

    private var hasFeedURL: Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String else {
            return false
        }
        return URL(string: value) != nil
    }

    var automaticallyChecksForUpdates: Bool {
        get {
            self.hasFeedURL && self.controller.updater.automaticallyChecksForUpdates
        }
        set {
            guard self.hasFeedURL else { return }
            self.controller.updater.automaticallyChecksForUpdates = newValue
        }
    }

    var automaticallyDownloadsUpdates: Bool {
        get {
            self.hasFeedURL && self.controller.updater.automaticallyDownloadsUpdates
        }
        set {
            guard self.hasFeedURL else { return }
            self.controller.updater.automaticallyDownloadsUpdates = newValue
        }
    }

    var canCheckForUpdates: Bool {
        self.hasFeedURL
    }

    var unavailableReason: String? {
        self.hasFeedURL ? nil : "Set SUFeedURL in the app bundle to enable updates."
    }

    func checkForUpdates(_ sender: Any?) {
        guard self.hasFeedURL else { return }
        self.controller.checkForUpdates(sender)
    }
}

extension SparkleUpdaterController: SPUUpdaterDelegate {}
