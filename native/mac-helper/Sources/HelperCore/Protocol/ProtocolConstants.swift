/// Wire-level constants. These mirror packages/schemas/src/helper-protocol.ts
/// and branding.ts; keep them in sync by hand.
public enum ProtocolConstants {
    public static let helperVersion = "0.1.0"
    public static let protocolVersion = "1.0"
    public static let unknownRequestId = "unknown"
    public static let maxRequestIdLength = 64
    public static let maxErrorMessageLength = 1000
    public static let defaultIdleThresholdSeconds: Double = 240
    public static let maxTypeTextLength = 2000
    public static let minApprovalTokenLength = 8
    public static let maxApprovalTokenLength = 128
    public static let maxAncestors = 12
    public static let maxWaitMs = 15_000
}

/// Commands accepted on stdin. Raw values are the exact `cmd` strings.
public enum HelperCommand: String, CaseIterable {
    case ping
    case capabilities
    case permissionStatus
    case requestAccessibilityPermission
    case requestScreenRecordingPermission
    case startObservation
    case stopObservation
    case frontmostContext
    case captureFrontmostWindow
    case ocrImage
    case focusedElement
    case accessibilityContextAtPoint
    case performAction
    case emergencyStop
    case shutdown
}

/// Streamed event names. Raw values are the exact `event` strings.
public enum HelperEventName: String, CaseIterable {
    case frontmostAppChanged
    case windowTitleChanged
    case mouseDown
    case shortcut
    case clipboardChanged
    case idleChanged
    case secureFieldFocused
    case helperReady
    case observationState
}

public enum HelperErrorCode: String, CaseIterable {
    case invalidRequest = "invalid_request"
    case unknownCommand = "unknown_command"
    case permissionDenied = "permission_denied"
    case notAvailable = "not_available"
    case captureFailed = "capture_failed"
    case ocrFailed = "ocr_failed"
    case actionRejected = "action_rejected"
    case emergencyStopped = "emergency_stopped"
    case internalError = "internal"
}

public enum PermissionState: String {
    case granted
    case denied
    case notDetermined = "not_determined"
    case unknown
}

public struct HelperError: Error, Equatable {
    public let code: HelperErrorCode
    public let message: String

    public init(_ code: HelperErrorCode, _ message: String) {
        self.code = code
        self.message = String(message.prefix(ProtocolConstants.maxErrorMessageLength))
    }
}
