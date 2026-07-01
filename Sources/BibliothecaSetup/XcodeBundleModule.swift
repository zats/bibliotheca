#if !SWIFT_PACKAGE
import Foundation

private final class BibliothecaSetupBundleMarker {}

extension Bundle {
    static let module = Bundle(for: BibliothecaSetupBundleMarker.self)
}
#endif
