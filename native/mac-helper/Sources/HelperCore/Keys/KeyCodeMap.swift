/// Key name -> macOS virtual key code (ANSI US layout, matches kVK_* constants
/// in Carbon's Events.h). Hardcoded so HelperCore stays free of Carbon.
public enum KeyCodeMap {
    public static let codes: [String: UInt16] = [
        "enter": 36, "return": 36, "tab": 48, "escape": 53, "esc": 53, "space": 49,
        "backspace": 51, "delete": 117,
        "up": 126, "down": 125, "left": 123, "right": 124,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98,
        "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
        "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4, "i": 34,
        "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35, "q": 12,
        "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7, "y": 16, "z": 6,
        "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25,
        "-": 27, "=": 24, "[": 33, "]": 30, ";": 41, "'": 39, ",": 43, ".": 47,
        "/": 44, "\\": 42, "`": 50
    ]

    /// Canonical names used when mapping a key code back to a name (aliases
    /// such as "return"/"esc" are never produced).
    private static let canonicalNames: [UInt16: String] = {
        var reverse: [UInt16: String] = [:]
        let preferred: Set<String> = ["enter", "escape", "backspace"]
        for (name, code) in codes {
            if preferred.contains(name) || reverse[code] == nil { reverse[code] = name }
        }
        for name in preferred { if let code = codes[name] { reverse[code] = name } }
        return reverse
    }()

    public static func keyCode(for name: String) -> UInt16? {
        codes[name]
    }

    public static func keyName(for code: UInt16) -> String? {
        canonicalNames[code]
    }
}
