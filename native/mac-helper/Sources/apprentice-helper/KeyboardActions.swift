import CoreGraphics
import Foundation
import HelperCore

/// Keyboard synthesis: unicode text in chunks, single keys, and modifier
/// chords. Tracks held modifiers so an emergency stop can release them.
final class KeyboardActions {
    private static let chunkSize = 20
    private static let interChunkMicroseconds: UInt32 = 8_000

    private let stopFlag: StopFlag
    private let source = CGEventSource(stateID: .combinedSessionState)
    private let lock = NSLock()
    private var heldModifiers: [ModifierKey] = []

    init(stopFlag: StopFlag) {
        self.stopFlag = stopFlag
    }

    func typeText(_ text: String) -> Result<Void, HelperError> {
        let units = Array(text.utf16)
        var index = 0
        while index < units.count {
            guard !stopFlag.isSet else { return .failure(ActionPerformer.stoppedError) }
            let chunk = Array(units[index..<min(index + Self.chunkSize, units.count)])
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                return .failure(HelperError(.internalError, "could not create keyboard event"))
            }
            chunk.withUnsafeBufferPointer { buffer in
                guard let base = buffer.baseAddress else { return }
                down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: base)
                up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: base)
            }
            down.flags = []
            up.flags = []
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            index += Self.chunkSize
            usleep(Self.interChunkMicroseconds)
        }
        return .success(())
    }

    func pressKey(keyCode: UInt16, flags: CGEventFlags) -> Result<Void, HelperError> {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
            return .failure(HelperError(.internalError, "could not create keyboard event"))
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        usleep(10_000)
        up.post(tap: .cghidEventTap)
        return .success(())
    }

    func hotkey(modifiers: [ModifierKey], keyCode: UInt16) -> Result<Void, HelperError> {
        var accumulated: UInt64 = 0
        for modifier in modifiers {
            guard !stopFlag.isSet else {
                releaseHeldModifiers()
                return .failure(ActionPerformer.stoppedError)
            }
            accumulated |= modifier.flagBit
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: modifier.keyCode, keyDown: true) else {
                releaseHeldModifiers()
                return .failure(HelperError(.internalError, "could not create modifier event"))
            }
            down.flags = CGEventFlags(rawValue: accumulated)
            down.post(tap: .cghidEventTap)
            lock.lock()
            heldModifiers.append(modifier)
            lock.unlock()
            usleep(5_000)
        }
        guard !stopFlag.isSet else {
            releaseHeldModifiers()
            return .failure(ActionPerformer.stoppedError)
        }
        let result = pressKey(keyCode: keyCode, flags: CGEventFlags(rawValue: accumulated))
        releaseHeldModifiers()
        return result
    }

    func releaseHeldModifiers() {
        lock.lock()
        let held = heldModifiers
        heldModifiers = []
        lock.unlock()
        var remaining = ModifierKey.flags(for: held)
        for modifier in held.reversed() {
            remaining &= ~modifier.flagBit
            guard let up = CGEvent(keyboardEventSource: source, virtualKey: modifier.keyCode, keyDown: false) else { continue }
            up.flags = CGEventFlags(rawValue: remaining)
            up.post(tap: .cghidEventTap)
            usleep(5_000)
        }
    }
}
