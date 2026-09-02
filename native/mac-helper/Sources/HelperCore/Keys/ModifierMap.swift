/// Modifier keys with their CGEventFlags bit and virtual key code. Raw flag
/// values equal CGEventFlags.maskCommand etc. so the executable can build a
/// CGEventFlags without HelperCore importing CoreGraphics event types.
public enum ModifierKey: String, CaseIterable, Equatable {
    case command
    case control
    case option
    case shift

    public var flagBit: UInt64 {
        switch self {
        case .command: return 1 << 20
        case .shift: return 1 << 17
        case .option: return 1 << 19
        case .control: return 1 << 18
        }
    }

    /// Left-side virtual key codes: kVK_Command, kVK_Shift, kVK_Option, kVK_Control.
    public var keyCode: UInt16 {
        switch self {
        case .command: return 55
        case .shift: return 56
        case .option: return 58
        case .control: return 59
        }
    }

    /// Lower-case short name used in `shortcut` events.
    public var shortName: String {
        switch self {
        case .command: return "cmd"
        case .shift: return "shift"
        case .option: return "alt"
        case .control: return "ctrl"
        }
    }

    public static func from(name: String) -> ModifierKey? {
        switch name {
        case "command", "cmd": return .command
        case "shift": return .shift
        case "alt", "option": return .option
        case "ctrl", "control": return .control
        default: return nil
        }
    }

    public static func flags(for modifiers: [ModifierKey]) -> UInt64 {
        modifiers.reduce(0) { $0 | $1.flagBit }
    }

    /// Modifiers present in a raw CGEventFlags value, in canonical order.
    public static func present(inFlags flags: UInt64) -> [ModifierKey] {
        [.command, .control, .option, .shift].filter { flags & $0.flagBit != 0 }
    }
}

/// Turns a keyDown into the `shortcut` event payload. Returns nil unless
/// command, control, or option is held: plain keystrokes are never reported.
public enum ShortcutFormatter {
    public static func keys(flags: UInt64, keyCode: UInt16) -> [String]? {
        let held = ModifierKey.present(inFlags: flags)
        let hasChord = held.contains { $0 == .command || $0 == .control || $0 == .option }
        guard hasChord else { return nil }
        let keyName = KeyCodeMap.keyName(for: keyCode) ?? "key\(keyCode)"
        return held.map(\.shortName) + [keyName]
    }
}
