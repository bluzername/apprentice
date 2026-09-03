import AppKit
import Foundation
import HelperCore

/// `activateApp`: brings the app with the given bundle id to the front so a
/// run acts on it rather than on the Apprentice window that requested the
/// approval. A running app is activated in place; an installed but not
/// running app is launched and activated; anything else reports
/// `activated:false`. Never performs any input.
enum AppActivation {
    private static let launchTimeout: TimeInterval = 5

    static func activate(params: [String: JSONValue]) -> Result<JSONValue, HelperError> {
        guard let raw = params["bundleId"]?.stringValue else {
            return .failure(HelperError(.invalidRequest, "bundleId is required"))
        }
        let bundleId = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !bundleId.isEmpty, bundleId.count <= 256 else {
            return .failure(HelperError(.invalidRequest, "bundleId must be 1-256 characters"))
        }
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            let activated = running.activate(options: [.activateIgnoringOtherApps])
            Log.info("activateApp \(bundleId): running pid=\(running.processIdentifier) activated=\(activated)")
            return .success(result(activated: activated, pid: running.processIdentifier))
        }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            Log.info("activateApp \(bundleId): not installed")
            return .success(result(activated: false, pid: nil))
        }
        return .success(launch(url: url, bundleId: bundleId))
    }

    /// Launches and activates the app at `url`, waiting briefly for the launch to settle.
    private static func launch(url: URL, bundleId: String) -> JSONValue {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let semaphore = DispatchSemaphore(value: 0)
        let box = LaunchOutcome()
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            box.set(app: app, error: error)
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + launchTimeout) == .timedOut {
            Log.warn("activateApp \(bundleId): launch did not settle within \(launchTimeout)s")
            return result(activated: false, pid: nil)
        }
        if let error = box.error {
            Log.warn("activateApp \(bundleId): launch failed: \(error.localizedDescription)")
            return result(activated: false, pid: nil)
        }
        guard let app = box.app else { return result(activated: false, pid: nil) }
        let activated = app.isActive || app.activate(options: [.activateIgnoringOtherApps])
        Log.info("activateApp \(bundleId): launched pid=\(app.processIdentifier) activated=\(activated)")
        return result(activated: activated, pid: app.processIdentifier)
    }

    private static func result(activated: Bool, pid: pid_t?) -> JSONValue {
        var object: [String: JSONValue] = ["activated": .bool(activated)]
        if let pid { object["pid"] = .int(Int(pid)) }
        return .object(object)
    }
}

/// Thread-safe holder for the asynchronous launch completion.
private final class LaunchOutcome: @unchecked Sendable {
    private let lock = NSLock()
    private var storedApp: NSRunningApplication?
    private var storedError: Error?

    var app: NSRunningApplication? {
        lock.lock()
        defer { lock.unlock() }
        return storedApp
    }

    var error: Error? {
        lock.lock()
        defer { lock.unlock() }
        return storedError
    }

    func set(app: NSRunningApplication?, error: Error?) {
        lock.lock()
        storedApp = app
        storedError = error
        lock.unlock()
    }
}
