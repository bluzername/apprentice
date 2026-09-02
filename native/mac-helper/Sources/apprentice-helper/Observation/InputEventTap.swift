import CoreGraphics
import Foundation
import HelperCore

/// Listen-only CGEvent tap for mouse-down and modifier shortcuts. Plain
/// keystrokes are never forwarded: `ShortcutFormatter` returns nil without
/// command/control/option, and the key event is dropped on the floor.
final class InputEventTap {
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?

    var onMouseDown: ((_ location: CGPoint, _ button: MouseButton) -> Void)?
    var onShortcut: ((_ keys: [String]) -> Void)?

    private static let callback: CGEventTapCallBack = { _, type, event, refcon in
        if let refcon {
            Unmanaged<InputEventTap>.fromOpaque(refcon).takeUnretainedValue().handle(type: type, event: event)
        }
        return Unmanaged.passUnretained(event)
    }

    /// Returns false when the tap cannot be created (missing Input Monitoring
    /// or Accessibility permission). Never throws or crashes.
    func start() -> Bool {
        stop()
        let mask: CGEventMask =
            (1 << CGEventType.leftMouseDown.rawValue) |
            (1 << CGEventType.rightMouseDown.rawValue) |
            (1 << CGEventType.otherMouseDown.rawValue) |
            (1 << CGEventType.keyDown.rawValue)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        guard let created = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                              options: .listenOnly, eventsOfInterest: mask,
                                              callback: Self.callback, userInfo: refcon) else {
            Log.warn("event tap unavailable (Input Monitoring / Accessibility not granted); mouse and shortcut events disabled")
            return false
        }
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: created, enable: true)
        tap = created
        source = runLoopSource
        return true
    }

    func stop() {
        if let tap {
            CGEvent.tapEnable(tap: tap, enable: false)
            if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
            CFMachPortInvalidate(tap)
        }
        tap = nil
        source = nil
    }

    fileprivate func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .leftMouseDown:
            onMouseDown?(event.location, .left)
        case .rightMouseDown:
            onMouseDown?(event.location, .right)
        case .otherMouseDown:
            onMouseDown?(event.location, .middle)
        case .keyDown:
            guard event.getIntegerValueField(.keyboardEventAutorepeat) == 0 else { return }
            let keyCode = UInt16(truncatingIfNeeded: event.getIntegerValueField(.keyboardEventKeycode))
            if let keys = ShortcutFormatter.keys(flags: event.flags.rawValue, keyCode: keyCode) {
                onShortcut?(keys)
            }
        default:
            break
        }
    }
}
