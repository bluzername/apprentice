import AppKit
import CoreGraphics
import Foundation
import HelperCore

struct DisplayDescriptor {
    let id: CGDirectDisplayID
    /// Global display points, top-left origin (CoreGraphics convention).
    let bounds: CGRect
    let scale: Double

    var rect: PointRect {
        PointRect(x: bounds.origin.x, y: bounds.origin.y, width: bounds.width, height: bounds.height)
    }
}

/// Active display enumeration. All rects are in CoreGraphics global points
/// (top-left origin), the same space as AX positions and CGEvent locations.
enum DisplayInfo {
    static func activeDisplays() -> [DisplayDescriptor] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
        return ids.prefix(Int(count)).map { id in
            DisplayDescriptor(id: id, bounds: CGDisplayBounds(id), scale: scale(for: id))
        }
    }

    static func displayRects() -> [PointRect] {
        activeDisplays().map(\.rect)
    }

    static func display(containing point: CGPoint) -> DisplayDescriptor? {
        let displays = activeDisplays()
        return displays.first { $0.bounds.contains(point) } ?? displays.first { $0.id == CGMainDisplayID() } ?? displays.first
    }

    static func display(containing rect: CGRect) -> DisplayDescriptor? {
        display(containing: CGPoint(x: rect.midX, y: rect.midY))
    }

    static func scale(for id: CGDirectDisplayID) -> Double {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        if let screen = NSScreen.screens.first(where: { ($0.deviceDescription[key] as? NSNumber)?.uint32Value == id }) {
            return Double(screen.backingScaleFactor)
        }
        let points = CGDisplayBounds(id).width
        guard points > 0 else { return 2 }
        return Double(CGDisplayPixelsWide(id)) / Double(points)
    }
}

struct WindowInfo {
    let id: CGWindowID
    let pid: pid_t
    let bounds: CGRect
    let title: String
}

/// On-screen window enumeration via the window server, front-to-back order.
enum WindowList {
    static func onScreenWindows(pid: pid_t) -> [WindowInfo] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
        return raw.compactMap { entry in
            guard let owner = entry[kCGWindowOwnerPID as String] as? pid_t, owner == pid,
                  let layer = entry[kCGWindowLayer as String] as? Int, layer == 0,
                  let number = entry[kCGWindowNumber as String] as? UInt32,
                  let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: boundsDict) else { return nil }
            let title = entry[kCGWindowName as String] as? String ?? ""
            return WindowInfo(id: number, pid: pid, bounds: bounds, title: title)
        }
    }

    static func frontmostWindow(pid: pid_t, preferredTitle: String? = nil) -> WindowInfo? {
        let windows = onScreenWindows(pid: pid)
        if let title = preferredTitle, !title.isEmpty, let match = windows.first(where: { $0.title == title }) {
            return match
        }
        return windows.first
    }
}
