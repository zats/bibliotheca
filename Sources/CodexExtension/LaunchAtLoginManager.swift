import ServiceManagement

enum LaunchAtLoginManager {
    static var isEnabled: Bool {
        switch SMAppService.mainApp.status {
        case .enabled, .requiresApproval:
            true
        case .notRegistered, .notFound:
            false
        @unknown default:
            false
        }
    }

    static func setEnabled(_ enabled: Bool) throws {
        let service = SMAppService.mainApp
        if enabled {
            switch service.status {
            case .enabled, .requiresApproval:
                return
            case .notRegistered, .notFound:
                break
            @unknown default:
                break
            }
            try service.register()
        } else {
            switch service.status {
            case .enabled, .requiresApproval:
                break
            case .notRegistered, .notFound:
                return
            @unknown default:
                break
            }
            try service.unregister()
        }
    }
}
