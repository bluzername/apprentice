/// Exact mirror of KEY_NAMES and MODIFIER_NAMES in packages/schemas/src/actions.ts.
/// Anything outside these lists is rejected before any CGEvent is created.
public enum KeyNames {
    public static let all: [String] = [
        "enter", "return", "tab", "escape", "esc", "space", "backspace", "delete",
        "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
        "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p",
        "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        "-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "`"
    ]

    public static let allSet: Set<String> = Set(all)

    public static let modifiers: [String] = ["command", "cmd", "shift", "alt", "option", "ctrl", "control"]

    public static let modifierSet: Set<String> = Set(modifiers)

    public static func isKnownKey(_ name: String) -> Bool {
        allSet.contains(name)
    }

    public static func isKnownModifier(_ name: String) -> Bool {
        modifierSet.contains(name)
    }
}
