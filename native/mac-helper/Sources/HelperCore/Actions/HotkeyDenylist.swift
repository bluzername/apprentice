import Foundation

/// Shortcuts the helper refuses to synthesize under any circumstance.
///
/// This is a hard floor below the approval path, not a policy: Command-Q quits
/// the application the run is working in (losing unsaved work and the run's
/// target window), and Command-Option-Escape opens Force Quit. A valid approval
/// token proves the desktop app asked for the action; it does not make either
/// of these recoverable, so they are rejected even when the token verifies.
///
/// The risk engine (packages/core/src/risk/classify.ts) also classifies both as
/// destructive so they can never be auto-approved. The two checks are
/// deliberately independent: this one holds even if that one is bypassed.
public enum HotkeyDenylist {
    public static let rejectionMessage = "hotkey is on the helper denylist and is never executed"

    /// Quit / force-quit keys, keyed by the key name as validated by `KeyNames`.
    private static let quitKeys: Set<String> = ["q"]
    private static let forceQuitKeys: Set<String> = ["escape", "esc"]

    /// True when this modifier + key combination must never reach CGEvent.
    public static func isDenied(modifiers: [ModifierKey], keyName: String) -> Bool {
        let key = keyName.lowercased()
        let hasCommand = modifiers.contains(.command)
        if hasCommand && quitKeys.contains(key) { return true }
        if hasCommand && modifiers.contains(.option) && forceQuitKeys.contains(key) { return true }
        return false
    }
}
