import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Secure event input (password fields, some terminals) as reported by the
/// window server. When enabled, event taps stop receiving key events anyway.
enum SecureInput {
    static var isEnabled: Bool {
        IsSecureEventInputEnabled()
    }
}

/// Seconds since the last user input event of any tracked type.
enum IdleTime {
    private static let trackedTypes: [CGEventType] = [
        .leftMouseDown, .rightMouseDown, .otherMouseDown, .mouseMoved,
        .leftMouseDragged, .rightMouseDragged, .keyDown, .flagsChanged, .scrollWheel
    ]

    static func secondsSinceLastInput() -> Double {
        trackedTypes
            .map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }
            .min() ?? 0
    }
}
