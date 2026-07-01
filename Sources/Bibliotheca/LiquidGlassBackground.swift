import AppKit
import SwiftUI

@MainActor
struct LiquidGlassBackground: NSViewRepresentable {
    func makeNSView(context: Context) -> NSGlassEffectView {
        let view = NSGlassEffectView()
        view.cornerRadius = 0
        return view
    }

    func updateNSView(_ nsView: NSGlassEffectView, context: Context) {}
}

@MainActor
struct GlassWindowBridge: NSViewRepresentable {
    func makeNSView(context: Context) -> GlassWindowBridgeView {
        GlassWindowBridgeView()
    }

    func updateNSView(_ nsView: GlassWindowBridgeView, context: Context) {
        nsView.apply()
    }
}

@MainActor
final class GlassWindowBridgeView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        self.apply()
    }

    func apply() {
        guard let window else { return }
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .clear
        window.isOpaque = false
    }
}
