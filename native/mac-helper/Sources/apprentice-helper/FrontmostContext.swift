import AppKit
import ApplicationServices
import Foundation
import HelperCore

/// Builds FrontmostContextResultSchema from NSWorkspace, AX, and the window
/// server. Works without Accessibility permission (window details degrade).
enum FrontmostContext {
    static func current() -> Result<JSONValue, HelperError> {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return .failure(HelperError(.notAvailable, "no frontmost application"))
        }
        let pid = app.processIdentifier
        var result: [String: JSONValue] = [
            "app": .object([
                "bundleId": .string(app.bundleIdentifier ?? ""),
                "name": .string(app.localizedName ?? ""),
                "pid": .int(Int(pid))
            ]),
            "isSecureInput": .bool(SecureInput.isEnabled)
        ]

        let axWindow = AXIsProcessTrusted()
            ? AXAttributes.element(AXAttributes.application(pid: pid), kAXFocusedWindowAttribute)
            : nil
        let axTitle = axWindow.flatMap { AXAttributes.string($0, kAXTitleAttribute) }
        let axFrame = axWindow.flatMap { AXAttributes.frame($0) }
        let listed = WindowList.frontmostWindow(pid: pid, preferredTitle: axTitle)
        let frame = axFrame ?? listed?.bounds

        var window: [String: JSONValue] = ["title": .string(String((axTitle ?? listed?.title ?? "").prefix(512)))]
        if let listed { window["id"] = .int(Int(listed.id)) }
        if let frame {
            window["bounds"] = PointRect(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height).toJSON()
        }
        if axWindow != nil || listed != nil { result["window"] = .object(window) }

        result["isFullscreen"] = .bool(axWindow.flatMap { AXAttributes.bool($0, "AXFullScreen") } ?? false)

        let anchor = frame.map { CGPoint(x: $0.midX, y: $0.midY) } ?? currentMouseLocation()
        let display = DisplayInfo.display(containing: anchor)
        result["displayScale"] = .number(display?.scale ?? 2)
        if let display { result["displayId"] = .string(String(display.id)) }
        return .success(.object(result))
    }

    /// Mouse location in CoreGraphics global coordinates (top-left origin).
    static func currentMouseLocation() -> CGPoint {
        CGEvent(source: nil)?.location ?? .zero
    }
}
