import Foundation

/// Strict validation of performAction params. Nothing here touches CGEvent;
/// the executable only acts on a `ValidatedAction`, which exists only after
/// the approval token verified against the per-spawn secret.
public enum ActionValidator {
    /// Full performAction check: token shape, then the HMAC binding the token
    /// to the action exactly as received, then the action contents. Without a
    /// `secret` (fixture or self-test use) every action is refused.
    public static func validate(params: [String: JSONValue], displays: [PointRect],
                                secret: ApprovalSecret?) -> Result<ValidatedAction, HelperError> {
        guard let token = params["approvalToken"]?.stringValue else {
            return .failure(HelperError(.actionRejected, "approvalToken is required"))
        }
        guard token.count >= ProtocolConstants.minApprovalTokenLength,
              token.count <= ProtocolConstants.maxApprovalTokenLength else {
            return .failure(HelperError(.actionRejected, "approvalToken must be 8-128 characters"))
        }
        guard let actionObject = params["action"]?.objectValue else {
            return .failure(HelperError(.actionRejected, "action must be an object"))
        }
        if case let .failure(error) = ApprovalTokenVerifier.verify(token: token, action: actionObject, secret: secret) {
            return .failure(error)
        }
        return validate(action: actionObject, displays: displays).map {
            ValidatedAction(action: $0, approvalToken: token)
        }
    }

    public static func validate(action: [String: JSONValue], displays: [PointRect]) -> Result<ExecutableAction, HelperError> {
        guard let type = action["type"]?.stringValue else {
            return .failure(HelperError(.actionRejected, "action.type is required"))
        }
        switch type {
        case "click":
            return point(action, displays).flatMap { p in
                button(action).map { .click(x: p.x, y: p.y, button: $0) }
            }
        case "double_click":
            return point(action, displays).map { .doubleClick(x: $0.x, y: $0.y) }
        case "move":
            return point(action, displays).map { .move(x: $0.x, y: $0.y) }
        case "scroll":
            return point(action, displays).flatMap { p in
                guard let dx = action["deltaX"]?.intValue, let dy = action["deltaY"]?.intValue else {
                    return .failure(HelperError(.actionRejected, "scroll deltaX/deltaY must be integers"))
                }
                guard abs(dx) <= 10_000, abs(dy) <= 10_000 else {
                    return .failure(HelperError(.actionRejected, "scroll delta out of range"))
                }
                return .success(.scroll(x: p.x, y: p.y, deltaX: dx, deltaY: dy))
            }
        case "type_text":
            guard let text = action["text"]?.stringValue else {
                return .failure(HelperError(.actionRejected, "type_text.text must be a string"))
            }
            guard text.count <= ProtocolConstants.maxTypeTextLength else {
                return .failure(HelperError(.actionRejected, "type_text.text exceeds \(ProtocolConstants.maxTypeTextLength) characters"))
            }
            return .success(.typeText(text))
        case "press_key":
            return key(action).map { .pressKey(keyName: $0.name, keyCode: $0.code) }
        case "hotkey":
            return key(action).flatMap { k in
                modifiers(action).map { .hotkey(modifiers: $0, keyName: k.name, keyCode: k.code) }
            }
        case "wait":
            guard let ms = action["ms"]?.intValue else {
                return .failure(HelperError(.actionRejected, "wait.ms must be an integer"))
            }
            guard ms >= 0, ms <= ProtocolConstants.maxWaitMs else {
                return .failure(HelperError(.actionRejected, "wait.ms must be 0-\(ProtocolConstants.maxWaitMs)"))
            }
            return .success(.wait(ms: ms))
        default:
            return .failure(HelperError(.actionRejected, "unsupported action type: \(type)"))
        }
    }

    private static func point(_ action: [String: JSONValue], _ displays: [PointRect]) -> Result<DisplayPoint, HelperError> {
        guard let x = action["x"]?.doubleValue, let y = action["y"]?.doubleValue else {
            return .failure(HelperError(.actionRejected, "x and y must be numbers"))
        }
        guard x.isFinite, y.isFinite else {
            return .failure(HelperError(.actionRejected, "x and y must be finite"))
        }
        guard DisplayGeometry.isWithinDisplays(x: x, y: y, displays: displays) else {
            return .failure(HelperError(.actionRejected, "point (\(x), \(y)) is outside all displays"))
        }
        return .success(DisplayPoint(x: x, y: y))
    }

    private static func button(_ action: [String: JSONValue]) -> Result<MouseButton, HelperError> {
        guard let raw = action["button"]?.stringValue else {
            return .failure(HelperError(.actionRejected, "click.button is required"))
        }
        guard let button = MouseButton(rawValue: raw) else {
            return .failure(HelperError(.actionRejected, "unknown mouse button: \(raw)"))
        }
        return .success(button)
    }

    private static func key(_ action: [String: JSONValue]) -> Result<(name: String, code: UInt16), HelperError> {
        guard let name = action["key"]?.stringValue else {
            return .failure(HelperError(.actionRejected, "key must be a string"))
        }
        guard KeyNames.isKnownKey(name), let code = KeyCodeMap.keyCode(for: name) else {
            return .failure(HelperError(.actionRejected, "unknown key name: \(name)"))
        }
        return .success((name, code))
    }

    private static func modifiers(_ action: [String: JSONValue]) -> Result<[ModifierKey], HelperError> {
        guard let raw = action["modifiers"]?.arrayValue else {
            return .failure(HelperError(.actionRejected, "modifiers must be an array"))
        }
        guard raw.count >= 1, raw.count <= 3 else {
            return .failure(HelperError(.actionRejected, "modifiers must contain 1-3 entries"))
        }
        var result: [ModifierKey] = []
        for entry in raw {
            guard let name = entry.stringValue, KeyNames.isKnownModifier(name),
                  let modifier = ModifierKey.from(name: name) else {
                return .failure(HelperError(.actionRejected, "unknown modifier: \(entry.stringValue ?? "?")"))
            }
            if !result.contains(modifier) { result.append(modifier) }
        }
        return .success(result)
    }
}
