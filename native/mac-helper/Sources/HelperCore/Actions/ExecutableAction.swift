/// Mirror of ExecutableActionSchema after strict validation. Key names are
/// already resolved to virtual key codes; modifiers to `ModifierKey`.
public enum MouseButton: String, Equatable {
    case left
    case right
    case middle
}

public enum ExecutableAction: Equatable {
    case click(x: Double, y: Double, button: MouseButton)
    case doubleClick(x: Double, y: Double)
    case move(x: Double, y: Double)
    case scroll(x: Double, y: Double, deltaX: Int, deltaY: Int)
    case typeText(String)
    case pressKey(keyName: String, keyCode: UInt16)
    case hotkey(modifiers: [ModifierKey], keyName: String, keyCode: UInt16)
    case wait(ms: Int)

    public var typeName: String {
        switch self {
        case .click: return "click"
        case .doubleClick: return "double_click"
        case .move: return "move"
        case .scroll: return "scroll"
        case .typeText: return "type_text"
        case .pressKey: return "press_key"
        case .hotkey: return "hotkey"
        case .wait: return "wait"
        }
    }
}

/// A performAction request that passed validation.
public struct ValidatedAction: Equatable {
    public let action: ExecutableAction
    public let approvalToken: String

    public init(action: ExecutableAction, approvalToken: String) {
        self.action = action
        self.approvalToken = approvalToken
    }
}
