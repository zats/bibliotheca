#if !SWIFT_PACKAGE
import Foundation

private final class CodexSetupBundleMarker {}

extension Bundle {
    static let module = Bundle(for: CodexSetupBundleMarker.self)
}
#endif
