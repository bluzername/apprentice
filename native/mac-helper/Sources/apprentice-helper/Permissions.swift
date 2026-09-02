import ApplicationServices
import CoreGraphics
import Foundation
import HelperCore

/// TCC status and prompts. Preflight calls never show UI; the request
/// variants do and are only invoked by the explicit request commands.
enum Permissions {
    static func accessibility() -> PermissionState {
        AXIsProcessTrusted() ? .granted : .denied
    }

    static func screenRecording() -> PermissionState {
        CGPreflightScreenCaptureAccess() ? .granted : .denied
    }

    static func inputMonitoring() -> PermissionState {
        CGPreflightListenEventAccess() ? .granted : .denied
    }

    static func statusJSON() -> JSONValue {
        .object([
            "accessibility": .string(accessibility().rawValue),
            "screenRecording": .string(screenRecording().rawValue),
            "inputMonitoring": .string(inputMonitoring().rawValue)
        ])
    }

    /// Shows the system Accessibility prompt when not yet trusted.
    static func requestAccessibility() -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Shows the system Screen Recording prompt when not yet decided.
    static func requestScreenRecording() -> Bool {
        CGRequestScreenCaptureAccess()
    }
}

/// Builds the capabilities result from the running process and OS.
enum CapabilitiesBuilder {
    static func current() -> Capabilities {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        let macos = "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        let sck: Bool
        if #available(macOS 14.0, *) { sck = true } else { sck = false }
        return Capabilities(
            arch: machineArchitecture(),
            macosVersion: macos,
            features: .init(accessibility: true, screenCaptureKit: sck, cgEvents: true,
                            visionOcr: true, fixtureStream: true)
        )
    }

    private static func machineArchitecture() -> String {
        var info = utsname()
        guard uname(&info) == 0 else { return "unknown" }
        return withUnsafePointer(to: &info.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
    }
}
