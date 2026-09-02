import AppKit
import ApplicationServices
import Foundation

/// Thin, failure-tolerant wrappers over AXUIElement attribute access.
enum AXAttributes {
    static func copy(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
        var value: AnyObject?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success else { return nil }
        return value
    }

    static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        copy(element, attribute) as? String
    }

    static func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        guard let value = copy(element, attribute) else { return nil }
        if let number = value as? NSNumber { return number.boolValue }
        return nil
    }

    static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
        guard let value = copy(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeBitCast(value, to: AXUIElement.self)
    }

    static func point(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
        guard let value = copy(element, attribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgPoint, AXValueGetValue(axValue, .cgPoint, &point) else { return nil }
        return point
    }

    static func size(_ element: AXUIElement, _ attribute: String) -> CGSize? {
        guard let value = copy(element, attribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        let axValue = unsafeBitCast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgSize, AXValueGetValue(axValue, .cgSize, &size) else { return nil }
        return size
    }

    /// Frame in global display points, top-left origin.
    static func frame(_ element: AXUIElement) -> CGRect? {
        guard let origin = point(element, kAXPositionAttribute), let size = size(element, kAXSizeAttribute) else { return nil }
        return CGRect(origin: origin, size: size)
    }

    /// Length of a text value without exposing the value itself.
    static func valueLength(_ element: AXUIElement) -> Int? {
        guard let value = copy(element, kAXValueAttribute) else { return nil }
        if let string = value as? String { return string.count }
        if let attributed = value as? NSAttributedString { return attributed.length }
        return nil
    }

    static func pid(_ element: AXUIElement) -> pid_t? {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success else { return nil }
        return pid
    }

    static func bundleId(forPid pid: pid_t) -> String {
        NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    }

    static func systemWide() -> AXUIElement {
        AXUIElementCreateSystemWide()
    }

    static func application(pid: pid_t) -> AXUIElement {
        AXUIElementCreateApplication(pid)
    }
}
