import Foundation

struct AsarCommand: Sendable {
    var executable: URL
    var arguments: [String]
    var environment: [String: String]
}
