import AppKit
import CoreGraphics
import Foundation
import HelperCore

/// captureFrontmostWindow: ScreenCaptureKit first, CGWindowList fallback.
/// Refuses early (no prompt) when Screen Recording is not granted.
enum WindowCapture {
    static func captureFrontmostWindow() -> Result<JSONValue, HelperError> {
        guard CGPreflightScreenCaptureAccess() else {
            return .failure(HelperError(.captureFailed,
                "Screen Recording permission is not granted for this process; grant it in System Settings > Privacy & Security > Screen Recording"))
        }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return .failure(HelperError(.notAvailable, "no frontmost application"))
        }
        guard let window = WindowList.frontmostWindow(pid: app.processIdentifier) else {
            return .failure(HelperError(.captureFailed, "frontmost application has no on-screen window"))
        }
        guard window.bounds.width >= 1, window.bounds.height >= 1 else {
            return .failure(HelperError(.captureFailed, "frontmost window has empty bounds"))
        }
        let display = DisplayInfo.display(containing: window.bounds)
        let scale = display?.scale ?? 2

        var method = "screencapturekit"
        var image: CGImage?
        switch ScreenCaptureKitCapture.capture(windowId: window.id, pointSize: window.bounds.size, scale: scale) {
        case let .success(captured):
            image = captured
        case let .failure(reason):
            Log.warn("ScreenCaptureKit capture failed (\(reason.message)); falling back to CGWindowList")
            method = "cgwindowlist"
            image = LegacyWindowCapture.capture(windowId: window.id)
        }
        guard let image else {
            return .failure(HelperError(.captureFailed, "both ScreenCaptureKit and CGWindowList capture failed"))
        }
        guard let png = ImageCodec.encodePNG(image) else {
            return .failure(HelperError(.captureFailed, "PNG encoding failed"))
        }
        var result: [String: JSONValue] = [
            "pngBase64": .string(png.base64EncodedString()),
            "width": .int(image.width),
            "height": .int(image.height),
            "displayScale": .number(scale),
            "bounds": PointRect(x: window.bounds.origin.x, y: window.bounds.origin.y,
                                width: window.bounds.width, height: window.bounds.height).toJSON(),
            "windowId": .int(Int(window.id)),
            "method": .string(method)
        ]
        if let display { result["displayId"] = .string(String(display.id)) }
        return .success(.object(result))
    }
}

/// CGWindowListCreateImage fallback. Deprecated since macOS 14 but still
/// functional; kept as the documented secondary path when SCK fails.
enum LegacyWindowCapture {
    static func capture(windowId: CGWindowID) -> CGImage? {
        CGWindowListCreateImage(.null, .optionIncludingWindow, windowId, [.boundsIgnoreFraming, .bestResolution])
    }
}
