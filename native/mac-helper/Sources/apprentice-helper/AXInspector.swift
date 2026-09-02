import ApplicationServices
import Foundation
import HelperCore

/// Serializes AX elements into AxElementSchema and answers the two AX
/// commands. Secure-field values are never read; text fields only report a
/// length.
enum AXInspector {
    private static let maxTextLength = 256

    static func focusedElement() -> Result<JSONValue, HelperError> {
        guard AXIsProcessTrusted() else {
            return .failure(HelperError(.permissionDenied, "Accessibility permission not granted"))
        }
        guard let element = AXAttributes.element(AXAttributes.systemWide(), kAXFocusedUIElementAttribute) else {
            return .success(.object(["element": .null, "bundleId": .string("")]))
        }
        return .success(.object([
            "element": serialize(element),
            "bundleId": .string(bundleId(of: element))
        ]))
    }

    static func context(params: [String: JSONValue]) -> Result<JSONValue, HelperError> {
        guard let x = params["x"]?.doubleValue, let y = params["y"]?.doubleValue, x.isFinite, y.isFinite else {
            return .failure(HelperError(.invalidRequest, "x and y must be finite numbers"))
        }
        guard AXIsProcessTrusted() else {
            return .failure(HelperError(.permissionDenied, "Accessibility permission not granted"))
        }
        var element: AXUIElement?
        let status = AXUIElementCopyElementAtPosition(AXAttributes.systemWide(), Float(x), Float(y), &element)
        guard status == .success, let element else {
            return .success(.object(["element": .null, "ancestors": .array([]), "bundleId": .string("")]))
        }
        return .success(.object([
            "element": serialize(element),
            "ancestors": .array(ancestors(of: element)),
            "bundleId": .string(bundleId(of: element))
        ]))
    }

    static func bundleId(of element: AXUIElement) -> String {
        guard let pid = AXAttributes.pid(element) else { return "" }
        return AXAttributes.bundleId(forPid: pid)
    }

    static func serialize(_ element: AXUIElement) -> JSONValue {
        let role = AXAttributes.string(element, kAXRoleAttribute) ?? ""
        let subrole = AXAttributes.string(element, kAXSubroleAttribute)
        let secure = AXRoleMapping.isSecure(axRole: role, subrole: subrole)
        var object: [String: JSONValue] = [
            "role": .string(String(role.prefix(64))),
            "isSecure": .bool(secure),
            "enabled": .bool(AXAttributes.bool(element, kAXEnabledAttribute) ?? true)
        ]
        if let subrole { object["subrole"] = .string(String(subrole.prefix(64))) }
        if let title = AXAttributes.string(element, kAXTitleAttribute), !title.isEmpty {
            object["title"] = .string(String(title.prefix(maxTextLength)))
        }
        if let description = AXAttributes.string(element, kAXDescriptionAttribute), !description.isEmpty {
            object["description"] = .string(String(description.prefix(maxTextLength)))
        }
        if let identifier = AXAttributes.string(element, kAXIdentifierAttribute), !identifier.isEmpty {
            object["identifier"] = .string(String(identifier.prefix(maxTextLength)))
        }
        if let frame = AXAttributes.frame(element) {
            object["bounds"] = PointRect(x: frame.origin.x, y: frame.origin.y,
                                         width: frame.width, height: frame.height).toJSON()
        }
        if !secure, AXRoleMapping.isTextEntry(axRole: role, subrole: subrole),
           let length = AXAttributes.valueLength(element) {
            object["valueLength"] = .int(length)
        }
        return .object(object)
    }

    static func ancestors(of element: AXUIElement) -> [JSONValue] {
        var result: [JSONValue] = []
        var current = element
        while result.count < ProtocolConstants.maxAncestors,
              let parent = AXAttributes.element(current, kAXParentAttribute) {
            var entry: [String: JSONValue] = [
                "role": .string(String((AXAttributes.string(parent, kAXRoleAttribute) ?? "").prefix(64)))
            ]
            if let title = AXAttributes.string(parent, kAXTitleAttribute), !title.isEmpty {
                entry["title"] = .string(String(title.prefix(maxTextLength)))
            }
            result.append(.object(entry))
            current = parent
        }
        return result
    }
}
