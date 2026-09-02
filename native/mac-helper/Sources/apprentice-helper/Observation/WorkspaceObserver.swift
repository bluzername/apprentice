import AppKit
import Foundation

/// Frontmost application changes via NSWorkspace. Must be started on the main
/// thread; callbacks arrive on the main queue.
final class WorkspaceObserver {
    private var token: NSObjectProtocol?
    var onActivate: ((NSRunningApplication) -> Void)?

    func start() {
        stop()
        token = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.onActivate?(app)
        }
    }

    func stop() {
        if let token { NSWorkspace.shared.notificationCenter.removeObserver(token) }
        token = nil
    }
}
